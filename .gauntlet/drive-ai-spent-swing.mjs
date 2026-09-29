/* ══════════════════════════════════════════════════════════════════════════
   🗡 DRIVE-AI-SPENT-SWING — does the AI stop walking toward an attack it has
   already spent?

   THE BUG. `tryAttackFromPos(atPos)` inside doAIStep answers "what is the best
   swing I could make if I stood HERE". It never reads `unit.hasAttacked` —
   deliberately, because the two REAL attack sites that call it are each gated
   on `!unit.hasAttacked` themselves (once before the move, once after it).
   The MOVEMENT scorer also calls it, once per candidate destination, and that
   call site was gated only on `!unit.hasMoved`. So a unit whose swing is
   already spent still scored every destination by an attack it cannot make.

   The clearest carrier is the DEFENDER passive: `hasPassive(unit,'defender')`
   forces `hasAttacked = true` at deploy (:164425) and again on every turn
   refresh (:114427), so a Defender can NEVER attack — and yet its movement
   scorer paid it up to 800+ for a phantom kill, which buried the SCREEN THE
   HERO interposition term (max ~(26+60·hurt)·threatAwareness, i.e. under 90).
   A unit that exists to stand in front of its hero marched away from it.

   THE FIX (public/index.html, the movement call site only):
       const reachable = unit.hasAttacked ? null : tryAttackFromPos(dest);

   ⚠ WHY THE CALL SITE AND NOT tryAttackFromPos ITSELF. Putting the check
     inside the helper would be invisible today — the real attack sites only
     call it when !hasAttacked — but it would become a kill switch on
     legitimate AI attacks the moment that gating moved. ARM C below is the
     assertion that catches that: a unit with hasAttacked FALSE must still
     score its eastern tiles non-zero and still walk east. A fix placed inside
     the helper fails ARM C; a fix placed at the call site passes it.

   ⚠ THE CONTROL IS A SECOND BUILD SERVED IN THE SAME RUN, not a number in a
     comment. The harness serves public/index.html a second time at
     /__control__.html with that one line textually reverted to the pre-fix
     `const reachable = tryAttackFromPos(dest);` — the revert count is ASSERTED
     to be exactly 1 — and runs the identical board in a second browser
     context. Same pattern, and the same reason, as drive-ai-threat-reach.

   ⚠ THE SCORE IS ASSERTED, NOT ONLY THE POSITION. A destination can change
     for a dozen unrelated reasons, so this reads `attackScore` itself for
     EVERY candidate tile. It cannot: tryAttackFromPos is a closure inside
     doAIStep and nothing outside can call it. So BOTH builds get ONE additive
     line injected at :168136, immediately before `if (sc > bestScore)`:

         try { if (window.__AITRACE) window.__AITRACE.push({...}) } catch(e){}

     It pushes and returns; it changes no score and no branch. That is a claim,
     so ARM E CHECKS it: the UNTOUCHED shipped index.html is opened as a third
     context, given the same board, and its unit must end on the same tile the
     traced build chose. Nothing was added to production code for this file.

   ⚠ THE AI IS DRIVEN, NOT SIMULATED. doAIStep runs on real timers against a
     real initGame board; this waits for aiBusy to clear. Nothing here
     re-implements the scorer.

   THE BOARD (pointy-top odd-r hex, so same-row distance is just |dx|):

        x= 2      4  5      7            9  10
     y=6 PH  .   W   .   .  U   .   .    A   E
     y=7         .  H(ai hero)

     U  (7,6) the AI unit under test — Defender passive, 3000 HP so no
              retreat/suicide term can fire, attack range 1, SPD tuned to
              move range 3 (ASSERTED, not assumed).
     E  (10,6) player chaff on 1 HP. From A (9,6) U kills it — aiScoreAttack
              pays damage + 800·finishBlowMul + a threat-removal bonus.
     H  (5,7) the AI's own hero, on 20/200 HP so `hurt` ≈ 0.9 and the
              interposition term is at its maximum.
     PH (2,6) the player HERO, 4 tiles from H, so `nearestFoeD <= 4` opens the
              SCREEN THE HERO branch. It is the `playerHero` the distance term
              pulls toward, so the -distToFoe·3·aggression pull also points
              WEST — the eastern tiles win in the control on ATTACK SCORE
              ALONE, which is the point.
     W  (4,6) the screening tile: dHero 2 < nearestFoeD 4 and dist(W,PH) 2 <= 2
              satisfies `onLine`, so it takes the (26+60·hurt)·_ta bonus. It is
              at distance 2 from PH — OUT of U's range-1 reach — so W scores no
              attack of its own even in the control build, and the two arms are
              not comparing two attack scores.

   FOUR ARMS, two builds × two values of hasAttacked, ONE board:
     A  pre-fix · spent   →  BEFORE: eastern attackScore non-zero, walks EAST
     B  fixed   · spent   →  AFTER:  attackScore 0 on EVERY tile, walks to W
     C  fixed   · unspent →  CONTROL: still non-zero east, still walks EAST
     D  pre-fix · unspent →  the fix is a NO-OP here; C and D must agree tile
                             for tile, which is what proves B is the guard
                             firing and not the board being rebuilt differently

   Run:  node .gauntlet/drive-ai-spent-swing.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ── build 1: the shipped file + the additive trace push ─────────────────── */
const PICK_LINE  = '          if (sc > bestScore) { bestScore = sc; best = dest; }';
const TRACE_LINE = '          try { if (window.__AITRACE) window.__AITRACE.push({ id: unit.id, x: dest.x, y: dest.y, attackScore: attackScore, sc: sc }); } catch (e) {}\r\n' + PICK_LINE;
const countOf = (hay, needle) => { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i++; } return n; };
const traceCount = countOf(SRC, PICK_LINE);
const TRACED = SRC.split(PICK_LINE).join(TRACE_LINE);

/* ── build 2: the same, with the one guarded line reverted to pre-fix ────── */
const FIXED_LINE = '          const reachable = unit.hasAttacked ? null : tryAttackFromPos(dest);';
const OLD_LINE   = '          const reachable = tryAttackFromPos(dest);';
const revertCount = countOf(TRACED, FIXED_LINE);
const CONTROL = TRACED.split(FIXED_LINE).join(OLD_LINE);

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  if (p === '/__traced__.html')  { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(TRACED); }
  if (p === '/__control__.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(CONTROL); }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
const P = 8830 + (process.pid % 40);
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function openBuild(file) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
    return r.abort();
  });
  await pg.goto('http://127.0.0.1:' + P + '/' + file, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForFunction('typeof initGame === "function" && typeof doAIStep === "function" && typeof getValidMoves === "function" && typeof buildUnit === "function"',
    null, { timeout: 200000 });
  await pg.waitForTimeout(5000);
  await installProbes(pg);
  return { pg, errs, file };
}

async function installProbes(pg) {
  await pg.evaluate(() => {
    /* THE BOARD. Coordinates are literal because the geometry is the whole
       experiment; every claim made about them in the header is re-measured by
       __probeBoard below and asserted by the harness, so a board that does not
       come out as described fails the run instead of quietly measuring
       something else. */
    window.__U = { x: 7, y: 6 };
    window.__W = { x: 4, y: 6 };   // the screening tile
    window.__A = { x: 9, y: 6 };   // the eastern attack tile (adjacent to chaff)

    window.__mkBoard = function (spent, spd) {
      App.battlePrep = App.battlePrep || {};
      const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
      App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
      App.state = initGame(me, foe, [], true, null);
      App.screen = 'battle';
      const s = App.state;
      // Strip every term that is not under test: no trucks, no weather, no
      // surfaces, no location, no cards to play, no Kalon, no ultimate.
      s.controlPoints = []; s.cpStreak = { ai: 0, player: 0 };
      s.weather = null; s.surfaces = {}; s.activeLocation = null;
      s.log = []; s.comboHits = {}; s.gameOver = null; s.heroUltimates = {};
      s.turnNumber = 1;
      s.ai = Object.assign({}, s.ai, { hand: [], deck: [], graveyard: [], energy: 0,
                                       kalonsRemaining: 0, kalonsThisTurn: 0 });
      s.player = Object.assign({}, s.player, { hand: [], graveyard: [] });

      const JAB = { id: 'dbJab', name: 'DB Jab', kind: 'attack', type: 'physical',
                    element: 'neutral', power: 45, accuracy: 100, crit: 0, range: 1, cost: 0 };
      const mk = (o) => Object.assign({
        isHero: false, alive: true, level: 5, currentHp: 3000, maxHp: 3000,
        stats: { hp: 3000, atk: 10, def: 10, mag: 10, res: 10, spd: 1 },
        elements: ['neutral'], passives: [], statusEffects: [], stages: {},
        moves: [], hasMoved: false, hasAttacked: false, aiActed: true,
        energy: 5, maxEnergy: 5,
      }, o);

      // U — the unit under test. `spent` is the ONLY thing that differs between
      // the two arms on a given build: same passives, same stats, same tile.
      const U = mk({ id: 'DB_U', owner: 'ai', name: 'DB Defender', pos: { ...window.__U },
                     passives: ['defender'], moves: [JAB], aiActed: false,
                     stats: { hp: 3000, atk: 70, def: 10, mag: 10, res: 10, spd: spd },
                     hasAttacked: !!spent });
      // The AI's own hero, badly hurt — `hurt` ≈ 0.9 maximises the screen term.
      const H = mk({ id: 'DB_H', owner: 'ai', name: 'DB AI Hero', isHero: true, pos: { x: 5, y: 7 },
                     currentHp: 20, maxHp: 200,
                     stats: { hp: 200, atk: 10, def: 10, mag: 10, res: 10, spd: 1 } });
      // The player hero closing on it. Weak on purpose: the threat map must not
      // be what decides this, and U's 3000 HP keeps the suicide guard silent.
      const PH = mk({ id: 'DB_PH', owner: 'player', name: 'DB Player Hero', isHero: true, pos: { x: 2, y: 6 },
                      currentHp: 400, maxHp: 400,
                      stats: { hp: 400, atk: 5, def: 10, mag: 5, res: 10, spd: 1 }, moves: [JAB] });
      // The bait: 1 HP chaff in the east, worth 800+ to kill.
      const E = mk({ id: 'DB_E', owner: 'player', name: 'DB Chaff', pos: { x: 10, y: 6 },
                     currentHp: 1, maxHp: 40,
                     stats: { hp: 40, atk: 5, def: 0, mag: 0, res: 0, spd: 1 } });
      s.units = [U, H, PH, E];
      return true;
    };

    /* What the board ACTUALLY is, read back through the game's own helpers. */
    window.__probeBoard = function () {
      const s = App.state;
      const U = s.units.find(u => u.id === 'DB_U');
      const H = s.units.find(u => u.id === 'DB_H');
      const PH = s.units.find(u => u.id === 'DB_PH');
      const E = s.units.find(u => u.id === 'DB_E');
      const dests = getValidMoves(U, s.units, s.weather).map(d => ({ x: d.x, y: d.y }));
      const has = (p) => dests.some(d => d.x === p.x && d.y === p.y);
      return {
        moveRange: getMoveRange(U, s.weather),
        atkRange: getEffectiveAttackRange(U, U.moves[0]),
        dests: dests,
        hasW: has(window.__W), hasA: has(window.__A),
        hasPHAdj: has({ x: 3, y: 6 }),           // must be FALSE — see header
        dUW: distance(U.pos, window.__W), dUA: distance(U.pos, window.__A),
        dAE: distance(window.__A, E.pos),
        dWPH: distance(window.__W, PH.pos),
        dWH: distance(window.__W, H.pos),
        dHPH: distance(H.pos, PH.pos),
        heroHurt: 1 - (H.currentHp / H.maxHp),
        uSpent: !!U.hasAttacked, uDefender: hasPassive(U, 'defender'),
        chaffHp: E.currentHp,
      };
    };

    /* PREMISE GROUNDING — the Defender passive really does produce hasAttacked
       on the engine's own paths, so "hasAttacked true" is not a flag this
       harness invented. Both are read from the live functions. */
    window.__probeDefenderPremise = function () {
      const s = App.state;
      const card = { id: 'dbDefCard', name: 'DB Wall', icon: '🧱', cardType: 'Unit',
                     stats: { hp: 20, atk: 3, def: 8, mag: 0, res: 0, spd: 2 },
                     passive: 'defender', elements: ['neutral'], level: 1, cost: 1 };
      let built = null, err = null;
      try { built = buildUnit(card, 'ai', { x: 8, y: 8 }, null); } catch (e) { err = String(e).slice(0, 120); }
      // …and that a turn refresh does NOT clear it (:114427).
      let refreshed = null;
      try {
        const s2 = startTurn({ ...s, units: s.units.map(u => ({ ...u, hasAttacked: false })) }, 'ai');
        const r = (s2.units || []).find(u => u.id === 'DB_U');
        refreshed = r ? !!r.hasAttacked : null;
      } catch (e) { refreshed = 'threw: ' + String(e).slice(0, 80); }
      return { buildUnitHasAttacked: built ? !!built.hasAttacked : null,
               buildUnitIsDefender: built ? hasPassive(built, 'defender') : null,
               startTurnKeepsIt: refreshed, err: err };
    };

    /* Drive ONE real AI phase and hand back the trace + where the unit ended. */
    window.__runAI = function () {
      const s = App.state; if (!s) return;
      window.__AITRACE = [];
      s.turn = 'ai';
      App.ui = App.ui || {};
      App.ui.aiBusy = true;
      try { scheduleAIStep(1); } catch (e) { App.ui.aiBusy = false; }
    };
    window.__result = function () {
      const s = App.state;
      const U = (s.units || []).find(u => u.id === 'DB_U');
      const tr = (window.__AITRACE || []).filter(t => t.id === 'DB_U');
      return {
        traced: tr,
        endPos: U && U.pos ? { x: U.pos.x, y: U.pos.y } : null,
        chaffAlive: !!(s.units || []).find(u => u.id === 'DB_E' && u.alive),
        diff: (typeof getAIDifficulty === 'function') ? (() => { const d = getAIDifficulty() || {};
          return { agg: d.aggression, ta: d.threatAwareness, fb: d.finishBlowMul }; })() : null,
      };
    };
  });
}

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

console.log('\n\u{1F5E1} AI — ALREADY-SPENT SWING vs THE MOVEMENT SCORER\n');
ok('the trace is injected at EXACTLY ONE site (the movement scorer\'s pick line)',
  traceCount === 1, 'matched ' + traceCount + ' occurrence(s)');
ok('the control build is the same file with EXACTLY ONE line reverted to pre-fix',
  revertCount === 1, 'reverted ' + revertCount + ' occurrence(s) of the guarded line');
if (traceCount !== 1 || revertCount !== 1) {
  console.log('\n❌ the builds could not be constructed — nothing below would mean anything.');
  await b.close(); srv.close(); process.exit(1);
}

const FIX = await openBuild('__traced__.html');
const CTL = await openBuild('__control__.html');
const RAW = await openBuild('index.html');          // untouched — ARM E only

/* SPD calibration: build, measure the REAL move range, correct, rebuild. Perks
   and passives can shift it, so the wanted range is measured and asserted
   rather than assumed. */
const WANT_RANGE = 3;
async function board(h, spent) {
  let spd = WANT_RANGE;
  await h.pg.evaluate(({ spent, spd }) => window.__mkBoard(spent, spd), { spent, spd });
  let m = await h.pg.evaluate(() => window.__probeBoard());
  if (m.moveRange !== WANT_RANGE) {
    spd = Math.max(1, WANT_RANGE - (m.moveRange - spd));
    await h.pg.evaluate(({ spent, spd }) => window.__mkBoard(spent, spd), { spent, spd });
    m = await h.pg.evaluate(() => window.__probeBoard());
  }
  return { spd, m };
}

async function drive(h, spent) {
  const { spd, m } = await board(h, spent);
  await h.pg.evaluate(() => window.__runAI());
  await h.pg.waitForFunction('!(App.ui && App.ui.aiBusy) || !App.state || App.state.gameOver',
    null, { timeout: 45000 }).catch(() => {});
  await h.pg.waitForTimeout(300);
  const r = await h.pg.evaluate(() => window.__result());
  return { spd, m, ...r };
}

const isEast = (p) => p && p.x > 7;
const isW    = (p) => p && p.x === 4 && p.y === 6;
const east   = (tr) => tr.filter(t => t.x > 7);
const maxAtk = (list) => list.reduce((a, t) => Math.max(a, t.attackScore), 0);
const argmax = (tr) => tr.reduce((a, t) => (a === null || t.sc > a.sc ? t : a), null);
const fmt    = (p) => p ? '(' + p.x + ',' + p.y + ')' : 'null';

/* ── PREMISE · the Defender passive is really what makes hasAttacked true ── */
const prem = await FIX.pg.evaluate(() => { window.__mkBoard(true, 3); return window.__probeDefenderPremise(); });
console.log('  premise: ' + JSON.stringify(prem));
ok('\u{1F9F1} PREMISE — buildUnit() gives a Defender-passive unit hasAttacked = true (:164425)',
  prem.buildUnitIsDefender === true && prem.buildUnitHasAttacked === true, JSON.stringify(prem));
ok('\u{1F9F1} PREMISE — startTurn() does NOT clear it (:114427), so a Defender enters every AI turn spent',
  prem.startTurnKeepsIt === true, 'startTurnKeepsIt ' + prem.startTurnKeepsIt);

/* ── the board is what the header claims ─────────────────────────────────── */
const A = await drive(CTL, true);    // pre-fix · spent
const B = await drive(FIX, true);    // fixed   · spent
const C = await drive(FIX, false);   // fixed   · unspent  ← THE CONTROL
const D = await drive(CTL, false);   // pre-fix · unspent

console.log('');
console.log('  board (fixed build, spent arm): ' + JSON.stringify({
  spd: B.spd, moveRange: B.m.moveRange, atkRange: B.m.atkRange, dests: B.m.dests.length,
  hasW: B.m.hasW, hasA: B.m.hasA, hasPHAdj: B.m.hasPHAdj,
  dUW: B.m.dUW, dUA: B.m.dUA, dAE: B.m.dAE, dWPH: B.m.dWPH, dWH: B.m.dWH, dHPH: B.m.dHPH,
  heroHurt: Number(B.m.heroHurt.toFixed(2)), defender: B.m.uDefender, spent: B.m.uSpent }));
console.log('  difficulty: ' + JSON.stringify(B.diff));

ok('U really carries the Defender passive and really starts the spent arm with hasAttacked true',
  B.m.uDefender === true && B.m.uSpent === true && C.m.uSpent === false,
  'defender ' + B.m.uDefender + ' · spentArm ' + B.m.uSpent + ' · controlArm ' + C.m.uSpent);
ok('move range is the intended 3 and attack range is 1',
  B.m.moveRange === WANT_RANGE && B.m.atkRange === 1,
  'moveRange ' + B.m.moveRange + ' (spd ' + B.spd + ') · atkRange ' + B.m.atkRange);
ok('the screening tile W(4,6) and the eastern attack tile A(9,6) are BOTH legal destinations',
  B.m.hasW === true && B.m.hasA === true, 'hasW ' + B.m.hasW + ' · hasA ' + B.m.hasA);
ok('A(9,6) is adjacent to the 1 HP chaff, so eastern tiles have a real kill to score',
  B.m.dAE === 1 && B.m.chaffHp === 1, 'dist(A,chaff) ' + B.m.dAE + ' · chaff HP ' + B.m.chaffHp);
ok('W(4,6) is a genuine SCREEN tile — dHero ' + B.m.dWH + ' < nearestFoeD ' + B.m.dHPH +
   ' and dist(W,playerHero) ' + B.m.dWPH + ' <= 2 (the onLine test)',
  B.m.dWH < B.m.dHPH && B.m.dHPH <= 4 && B.m.dWPH <= 2,
  JSON.stringify({ dWH: B.m.dWH, dHPH: B.m.dHPH, dWPH: B.m.dWPH }));
ok('W scores NO attack of its own — the player hero sits 2 tiles away, outside U\'s range 1, ' +
   'so the arms are not comparing two attack scores',
  B.m.dWPH > B.m.atkRange, 'dist(W,playerHero) ' + B.m.dWPH + ' vs attack range ' + B.m.atkRange);
ok('U cannot reach the tile beside the player hero, so no arm can be decided by a hero swing',
  B.m.hasPHAdj === false, 'hasPHAdj ' + B.m.hasPHAdj);
ok('every arm scored the same candidate set',
  A.traced.length === B.traced.length && B.traced.length === C.traced.length &&
  C.traced.length === D.traced.length && B.traced.length === B.m.dests.length,
  'A ' + A.traced.length + ' · B ' + B.traced.length + ' · C ' + C.traced.length +
  ' · D ' + D.traced.length + ' · validMoves ' + B.m.dests.length);
ok('the trace really describes the decision — argmax(sc) is the tile the AI ended on, in all four arms',
  [A, B, C, D].every(r => { const g = argmax(r.traced); return g && r.endPos && g.x === r.endPos.x && g.y === r.endPos.y; }),
  [A, B, C, D].map(r => fmt(argmax(r.traced)) + '/' + fmt(r.endPos)).join(' '));

/* ── ARM A · BEFORE ──────────────────────────────────────────────────────── */
console.log('');
console.log('  ARM A · PRE-FIX build, hasAttacked TRUE   → ended ' + fmt(A.endPos) +
  ' · max eastern attackScore ' + maxAtk(east(A.traced)) + ' · max attackScore anywhere ' + maxAtk(A.traced));
ok('\u{1F534} ARM A (BEFORE) — the spent unit scored the EASTERN tiles NON-ZERO. This is the bug.',
  maxAtk(east(A.traced)) > 0, 'max eastern attackScore ' + maxAtk(east(A.traced)));
ok('\u{1F534} ARM A (BEFORE) — …and walked EAST, toward a swing it can never make',
  isEast(A.endPos), 'ended ' + fmt(A.endPos));

/* ── ARM B · AFTER ───────────────────────────────────────────────────────── */
console.log('');
console.log('  ARM B · FIXED build,   hasAttacked TRUE   → ended ' + fmt(B.endPos) +
  ' · max attackScore over ALL ' + B.traced.length + ' destinations ' + maxAtk(B.traced));
ok('\u{1F3AF} ARM B (AFTER) — attackScore is 0 for EVERY destination, not merely for the eastern ones',
  B.traced.length > 0 && B.traced.every(t => t.attackScore === 0),
  B.traced.filter(t => t.attackScore !== 0).map(t => fmt(t) + '=' + t.attackScore).join(' ') || 'all 0');
ok('\u{1F3AF} ARM B (AFTER) — the chosen destination is the WESTERN screening tile W(4,6)',
  isW(B.endPos), 'ended ' + fmt(B.endPos));
ok('\u{1F3AF} ARM B (AFTER) — the two arms genuinely disagree: A ended ' + fmt(A.endPos) +
   ', B ended ' + fmt(B.endPos),
  !(A.endPos && B.endPos && A.endPos.x === B.endPos.x && A.endPos.y === B.endPos.y));
ok('ARM B — the spent unit did not attack anything (the chaff is still standing)',
  B.chaffAlive === true, 'chaffAlive ' + B.chaffAlive);

/* ── ARM C · THE CONTROL — the guard must not disable real attacks ───────── */
console.log('');
console.log('  ARM C · FIXED build,   hasAttacked FALSE  → ended ' + fmt(C.endPos) +
  ' · max eastern attackScore ' + maxAtk(east(C.traced)));
ok('\u{1F6D1} ARM C (THE CONTROL) — an identical unit with hasAttacked FALSE still scores the eastern ' +
   'tiles NON-ZERO. A guard put inside tryAttackFromPos instead of at this call site fails here.',
  maxAtk(east(C.traced)) > 0, 'max eastern attackScore ' + maxAtk(east(C.traced)));
ok('\u{1F6D1} ARM C (THE CONTROL) — …and it still walks EAST',
  isEast(C.endPos), 'ended ' + fmt(C.endPos));
ok('\u{1F6D1} ARM C (THE CONTROL) — …and it actually kills the chaff, so the attack path still works',
  C.chaffAlive === false, 'chaffAlive ' + C.chaffAlive);

/* ── ARM D · the fix is a NO-OP for an unspent unit ──────────────────────── */
const sameTrace = C.traced.length === D.traced.length && C.traced.every((t, i) =>
  t.x === D.traced[i].x && t.y === D.traced[i].y && t.attackScore === D.traced[i].attackScore);
console.log('');
console.log('  ARM D · PRE-FIX build, hasAttacked FALSE  → ended ' + fmt(D.endPos) +
  ' · max eastern attackScore ' + maxAtk(east(D.traced)));
ok('\u{1F501} ARM D — with hasAttacked FALSE the two builds are IDENTICAL, tile for tile, ' +
   'attackScore for attackScore. The change touches nothing but the spent case.',
  sameTrace, sameTrace ? 'all ' + C.traced.length + ' destinations match'
    : C.traced.map((t, i) => fmt(t) + ' ' + t.attackScore + ' vs ' + (D.traced[i] ? D.traced[i].attackScore : '—')).join(' | ').slice(0, 300));
ok('\u{1F501} ARM D — and both unspent arms end on the same tile',
  D.endPos && C.endPos && D.endPos.x === C.endPos.x && D.endPos.y === C.endPos.y,
  'C ' + fmt(C.endPos) + ' · D ' + fmt(D.endPos));

/* ── ARM E · the injected trace line changed nothing ─────────────────────── */
const E1 = await drive(RAW, true);
const E2 = await drive(RAW, false);
console.log('');
console.log('  ARM E · UNTOUCHED public/index.html (no trace injected) → spent ' + fmt(E1.endPos) +
  ' · unspent ' + fmt(E2.endPos));
ok('\u{1F50E} ARM E — the untouched shipped build makes the SAME two choices as the traced build, ' +
   'so the injected push is inert and arms A–D are measuring the real scorer',
  E1.endPos && B.endPos && E1.endPos.x === B.endPos.x && E1.endPos.y === B.endPos.y &&
  E2.endPos && C.endPos && E2.endPos.x === C.endPos.x && E2.endPos.y === C.endPos.y,
  'raw spent ' + fmt(E1.endPos) + ' vs traced ' + fmt(B.endPos) + ' · raw unspent ' +
  fmt(E2.endPos) + ' vs traced ' + fmt(C.endPos));
ok('ARM E — the untouched build recorded no trace at all (nothing was added to production code)',
  E1.traced.length === 0 && E2.traced.length === 0,
  'entries ' + E1.traced.length + '/' + E2.traced.length);

console.log('');
ok('no page errors on the fixed build', FIX.errs.length === 0, FIX.errs.slice(0, 3).join(' | '));
ok('no page errors on the control build', CTL.errs.length === 0, CTL.errs.slice(0, 3).join(' | '));
ok('no page errors on the untouched build', RAW.errs.length === 0, RAW.errs.slice(0, 3).join(' | '));
console.log('');
console.log(fails === 0 ? '✅ PASS' : '❌ ' + fails + ' FAILED');
await b.close(); srv.close();
process.exit(fails === 0 ? 0 : 1);
