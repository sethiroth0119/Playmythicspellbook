/* ══════════════════════════════════════════════════════════════════════════
   🎲 DRIVE-AI-DAMAGE-DETERMINISM — does the AI still reason with a dice roll?

   calculateDamage is the AI's damage ORACLE: aiEstimateThreat and
   aiScoreAttack both call it to ask "how hard would this land?". It contains
   five Math.random() calls (accuracy, faewish dodge, status dodgeChance,
   Phantom Presence, crit), and the AI's `{ accuracy: 100, crit: 0 }` override
   does NOT survive them — accuracy is still cut by _skillDodge / mist / smoke
   AFTER the override, and crit is still topped up by packTactics /
   _loadoutCritBonus / bond / location AFTER it. So every number the suicide
   guard, the low-HP retreat, placement safety and the threat map read was a
   fresh sample. The fix is opt-in: calculateDamage takes a 5th `opts` argument
   and, when opts.aiExpectedValue is set, takes NO random branch and returns
   expected damage weighted by hit and crit chance.

   ⚠ THE CONTROL IS THE SAME FILE WITH THE FLAG STRIPPED. There is no way to
     monkeypatch calculateDamage from the page (it is a script-scope `const`,
     not a window property, and not reassignable), and reimplementing the AI's
     choice rule in the harness would be testing a twin. So the harness serves
     a SECOND copy of public/index.html at /__control__.html with the literal
     text `, { aiExpectedValue: true }` deleted from the two AI call sites —
     byte-identical to the old behaviour — and runs the identical scenario in
     a second browser context. The strip count is ASSERTED to be exactly 2,
     which doubles as the check that no other call site sets the flag.

   ⚠ THE ASSERTION IS ON THE AI'S CHOICE, NOT ON A NUMBER IT COMPUTED.
     Arm C builds a board with two reachable enemies and one right answer, runs
     the REAL doAIStep on real timers, and reads back WHO GOT HIT from
     s.comboHits and the battle log — not from any scoring function called by
     the harness.

   ⚠ ARM F IS THE DEFENDER HALF OF ARM E. The same expectation-vs-lethality
     mistake exists on both sides of the oracle, and the second one is the
     higher-traffic one: aiEstimateThreat feeds the movement loop's SUICIDE
     GUARD, which asks "would the threat at this tile KILL me?" of a number
     that had become an average. A shot that KOs a 30 HP unit whenever it
     connects read as 25 damage, the guard never fired, and a healthy unit
     walked onto the tile every single turn. ARM F runs THREE builds — fixed,
     pre-fix (expectation kept, old guard), and the original rolled control —
     and reads back WHERE THE UNIT STOOD, not a score it computed.

   ⚠ ARM C AND ARM E MUST BOTH HOLD. Arm C shows the AI now takes the better
     BET (it stops chasing a juicy hit it will probably miss). Arm E shows it
     still EXECUTES: an expectation is not a kill test, and the first cut of
     this fix compared EXPECTED damage against currentHp, so a 60%-lethal blow
     stopped counting as a kill and the +800 KO bonus went silent against
     anything evasive. Either arm alone can be satisfied by a build that is
     worse overall, which is why both run.

   ⚠ ARM D IS A TRIPWIRE, NOT A FEATURE TEST. If the bypass ever leaks into the
     unflagged path, live combat stops rolling and the game silently loses its
     dice. Arm D fails the run if the ROLLED path goes quiet.

   Run:  node .gauntlet/drive-ai-damage-determinism.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

/* ── build the CONTROL document: the shipped file, flag removed ───────────── */
const FLAG_ARG = ', { aiExpectedValue: true }';
const shipped = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const stripCount = shipped.split(FLAG_ARG).length - 1;
const controlDoc = shipped.split(FLAG_ARG).join('');

/* ── build the PRE-FIX document: the shipped file with the DEFENDER-side
      lethality fix reverted, EV flag left in place ─────────────────────────
   ARM F needs three builds, not two. The control above is the ORIGINAL rolled
   AI; this one is the intermediate build that had the expectation but still
   compared it straight against currentHp in the suicide guard. Without it the
   arm could only show "fixed build is safer than the rolled one" and would
   never demonstrate the regression it was written for. Reverting is a literal
   two-line swap, asserted to hit exactly once. */
const GUARD_NEW = [
  '          if (!lowHp && _threatD.landed >= unit.currentHp && attackScore < 700) {',
  '            sc -= (140 + _threatD.landed) * _ta * _threatD.pHit;',
  '          }',
].join('\r\n');
const GUARD_OLD = [
  '          if (!lowHp && threat >= unit.currentHp && attackScore < 700) {',
  '            sc -= (140 + threat) * _ta;',
  '          }',
].join('\r\n');
const guardHits = shipped.split(GUARD_NEW).length - 1;
const prefixDoc = shipped.split(GUARD_NEW).join(GUARD_OLD);

const P = 8690 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  if (p === '/__control__.html') {
    r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(controlDoc);
  }
  if (p === '/__prefix__.html') {
    r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(prefixDoc);
  }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
async function open(doc) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(doc + ': ' + String(e).slice(0, 160)));
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
    return r.abort();
  });
  await pg.goto('http://127.0.0.1:' + P + '/' + doc, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForFunction('typeof calculateDamage === "function" && typeof initGame === "function" && typeof aiIncomingThreatAt === "function"', null, { timeout: 200000 });
  await pg.waitForTimeout(4000);
  return pg;
}

/* Shared board builder — injected into BOTH documents so the two arms differ
   in exactly one thing: whether the AI's oracle rolls. */
const BOARD = `
window.__setupBoard = function () {
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  App.screen = 'battle';
  const s = App.state;
  const JAB = { id: 'drvjab', name: 'Drv Jab', kind: 'attack', type: 'physical',
                element: 'neutral', power: 45, accuracy: 100, crit: 0, range: 1, cost: 0 };
  const mk = (o) => Object.assign({
    isHero: false, alive: true, level: 5,
    currentHp: 3000, maxHp: 3000,
    stats: { hp: 3000, atk: 10, def: 10, mag: 10, res: 10, spd: 3 },
    elements: ['neutral'], passives: [], statusEffects: [], stages: {},
    moves: [], hasMoved: false, hasAttacked: false, aiActed: true,
    energy: 5, maxEnergy: 5,
  }, o);

  const aiHero = s.units.find(u => u.owner === 'ai' && u.isHero);
  const pHero  = s.units.find(u => u.owner === 'player' && u.isHero);
  // Both heroes are parked and flagged as already-acted: the ONLY unit allowed
  // to think this turn is the crafted attacker, so the choice we read back is
  // unambiguously its choice.
  const parkA = { x: 0, y: 0 }, parkP = { x: BOARD_W - 1, y: BOARD_H - 1 };
  const atkPos = { x: 4, y: 4 };
  const nb = hexNeighbors(atkPos.x, atkPos.y);

  const ATT = mk({ id: 'DRV_ATT', owner: 'ai', name: 'Attacker', pos: atkPos,
                   stats: { hp: 3000, atk: 70, def: 10, mag: 10, res: 10, spd: 3 },
                   moves: [JAB], aiActed: false });
  // SOLID  — cannot dodge at all. def 30 → a 28-point jab (measured, not assumed;
  // the setup assertion below re-measures it every run).
  const SOLID = mk({ id: 'DRV_SOLID', owner: 'player', name: 'Solid',
                     pos: { x: nb[0].x, y: nb[0].y },
                     stats: { hp: 3000, atk: 1, def: 30, mag: 1, res: 30, spd: 1 } });
  // SLIPPERY — softer (def 20 → a 41-point jab), so a LANDED hit is worth
  // strictly more than SOLID, but it dodges 60% of the time so its EXPECTED
  // value (~16) is strictly worse. That gap is the whole experiment.
  const SLIP = mk({ id: 'DRV_SLIP', owner: 'player', name: 'Slippery',
                    pos: { x: nb[1].x, y: nb[1].y }, _skillDodge: 60,
                    stats: { hp: 3000, atk: 1, def: 20, mag: 1, res: 20, spd: 1 } });
  // DECOY — 5 HP, parked out of reach. aiScoreAttack pays +60 to the player's
  // lowest-HP non-hero; the decoy soaks that bonus so it cannot tilt the
  // SOLID-vs-SLIPPERY comparison in either arm.
  const DECOY = mk({ id: 'DRV_DECOY', owner: 'player', name: 'Decoy',
                     pos: { x: BOARD_W - 1, y: 0 }, currentHp: 5, maxHp: 5 });

  s.units = [
    Object.assign({}, aiHero, { pos: parkA, aiActed: true, hasMoved: true, hasAttacked: true }),
    Object.assign({}, pHero,  { pos: parkP }),
    ATT, SOLID, SLIP, DECOY,
  ];
  s.ai = s.ai || {}; s.ai.energy = 10;
  s.comboHits = {}; s.log = [];
  s.weather = null;
  return {
    d_solid: distance(atkPos, SOLID.pos),
    d_slip: distance(atkPos, SLIP.pos),
    d_decoy: distance(atkPos, DECOY.pos),
  };
};

/* Read back WHO the AI actually attacked, from LOST HP.
   ⚠ s.comboHits looked like the natural instrument and is NOT usable here: the
     AI ends its own turn, and startTurn wipes comboHits, so it always read
     empty by the time the harness looked. HP is the surviving evidence.
     A blow the AI chose but then DODGED leaves no HP mark, so the "→ MISSED!"
     log line is the second witness — the AI unit only rolls a miss if it
     picked the dodgy target, since SOLID has no dodge at all. */
window.__readChoice = function () {
  const s = App.state;
  const u = (id) => s.units.find(x => x.id === id) || {};
  const solidHp = u('DRV_SOLID').currentHp, slipHp = u('DRV_SLIP').currentHp;
  const missed = (s.log || []).some(l => l && typeof l.msg === 'string' && l.msg.indexOf('MISSED') >= 0);
  return { solid: solidHp < 3000, slip: slipHp < 3000, missed, solidHp, slipHp,
           acted: !!u('DRV_ATT').hasAttacked };
};

/* ── ARM E's board: a PROBABLE KILL sitting next to a safe chip target ─────
   Same shape as the ARM C board, but the evasive unit is now KILLABLE. This
   is the position that caught the first cut of this fix: probe.damage became
   EXPECTED damage while aiScoreAttack still tested it with
   >= target.currentHp, so a blow that kills 60% of the time stopped
   registering as a kill at all, the +800 never fired, and the AI chipped the
   wall 20/20 turns instead of executing the unit it could finish.
     FRAIL  30 HP, def 20, _skillDodge 40 -> a LANDED jab is 41 (lethal),
            expected 25 (not lethal). Killing it is worth far more than...
     WALL   3000 HP, def 30, no dodge     -> 28 chip, never lethal.
   DECOY again soaks aiScoreAttack's +60 lowest-HP focus-fire bonus so it
   cannot tilt the comparison in either arm. */
window.__setupKO = function () {
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  App.screen = 'battle';
  const s = App.state;
  const JAB = { id: 'kojab', name: 'KO Jab', kind: 'attack', type: 'physical',
                element: 'neutral', power: 45, accuracy: 100, crit: 0, range: 1, cost: 0 };
  const mk = (o) => Object.assign({
    isHero: false, alive: true, level: 5,
    currentHp: 3000, maxHp: 3000,
    stats: { hp: 3000, atk: 10, def: 10, mag: 10, res: 10, spd: 3 },
    elements: ['neutral'], passives: [], statusEffects: [], stages: {},
    moves: [], hasMoved: false, hasAttacked: false, aiActed: true,
    energy: 5, maxEnergy: 5,
  }, o);
  const aiHero = s.units.find(u => u.owner === 'ai' && u.isHero);
  const pHero  = s.units.find(u => u.owner === 'player' && u.isHero);
  const atkPos = { x: 4, y: 4 };
  const nb = hexNeighbors(atkPos.x, atkPos.y);
  const ATT = mk({ id: 'KO_ATT', owner: 'ai', name: 'Attacker', pos: atkPos,
                   stats: { hp: 3000, atk: 70, def: 10, mag: 10, res: 10, spd: 3 },
                   moves: [JAB], aiActed: false });
  const FRAIL = mk({ id: 'KO_FRAIL', owner: 'player', name: 'Frail',
                     pos: { x: nb[0].x, y: nb[0].y }, _skillDodge: 40,
                     currentHp: 30, maxHp: 30,
                     stats: { hp: 30, atk: 1, def: 20, mag: 1, res: 20, spd: 1 } });
  const WALL = mk({ id: 'KO_WALL', owner: 'player', name: 'Wall',
                    pos: { x: nb[1].x, y: nb[1].y },
                    stats: { hp: 3000, atk: 1, def: 30, mag: 1, res: 30, spd: 1 } });
  const DECOY = mk({ id: 'KO_DECOY', owner: 'player', name: 'Decoy',
                     pos: { x: BOARD_W - 1, y: 0 }, currentHp: 5, maxHp: 5 });
  s.units = [
    Object.assign({}, aiHero, { pos: { x: 0, y: 0 }, aiActed: true, hasMoved: true, hasAttacked: true }),
    Object.assign({}, pHero,  { pos: { x: BOARD_W - 1, y: BOARD_H - 1 } }),
    ATT, FRAIL, WALL, DECOY,
  ];
  s.ai = s.ai || {}; s.ai.energy = 10;
  s.comboHits = {}; s.log = []; s.weather = null;
  return { d_frail: distance(atkPos, FRAIL.pos), d_wall: distance(atkPos, WALL.pos), d_decoy: distance(atkPos, DECOY.pos) };
};
/* Same HP-is-the-evidence rule as __readChoice. Only FRAIL can dodge, so a
   'MISSED' line with no HP lost anywhere means the AI DID choose FRAIL and the
   40% dodge ate the blow — that still counts as going for the kill. */
window.__readKO = function () {
  const s = App.state;
  const u = (id) => s.units.find(x => x.id === id) || {};
  const f = u('KO_FRAIL'), w = u('KO_WALL');
  const missed = (s.log || []).some(l => l && typeof l.msg === 'string' && l.msg.indexOf('MISSED') >= 0);
  return { frailHit: (f.currentHp < 30) || f.alive === false,
           frailDead: f.alive === false || f.currentHp <= 0,
           wallHit: w.currentHp < 3000, missed, acted: !!u('KO_ATT').hasAttacked };
};

/* ── ARM F's board: the DEFENDER side of the same expectation-vs-lethality
      mistake ──────────────────────────────────────────────────────────────
   aiEstimateThreat feeds the movement loop's SUICIDE GUARD, which asks
   "does the incoming threat at this tile KILL me?". Once the threat map
   returned an EXPECTATION, an archer shot that KOs a 30 HP unit whenever it
   connects read as 25 damage and the guard stopped firing.
     MOVER   30/30 HP, healthy (so lowHp is false and the retreat branch is
             NOT what we are measuring), _skillDodge 40, move range 2, and a
             jab that scores 80 against the archer — well under the guard's
             own 700 bypass, so the guard is allowed to veto it.
     ARCHER  3 hex steps away with a range-1 shot. Its LANDED damage on the
             mover is 41 (lethal), its EXPECTED damage 25 (not lethal).
   The mover therefore has a tile that is worth 80 to stand on and kills it
   whenever the shot connects, plus safe tiles outside the archer's reach.
   A DECOY soaks aiScoreAttack's lowest-HP focus-fire bonus, and controlPoints
   is emptied so the objective term cannot move the answer. */
window.__setupF = function (opts) {
  opts = opts || {};
  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  App.screen = 'battle';
  const s = App.state;
  s.controlPoints = []; s.cpStreak = { ai: 0, player: 0 };
  const mk = (o) => Object.assign({
    isHero: false, alive: true, level: 5, currentHp: 3000, maxHp: 3000,
    stats: { hp: 3000, atk: 10, def: 10, mag: 10, res: 10, spd: 1 },
    elements: ['neutral'], passives: [], statusEffects: [], stages: {},
    moves: [], hasMoved: false, hasAttacked: false, aiActed: true, energy: 5, maxEnergy: 5,
  }, o);
  const JAB  = { id: 'fjab',  name: 'F Jab',  kind: 'attack', type: 'physical',
                 element: 'neutral', power: 45, accuracy: 100, crit: 0, range: 1, cost: 0 };
  const SHOT = { id: 'fshot', name: 'F Shot', kind: 'attack', type: 'physical',
                 element: 'neutral', power: 45, accuracy: 100, crit: 0, range: 1, cost: 0 };
  const aiHero = s.units.find(u => u.owner === 'ai' && u.isHero);
  const pHero  = s.units.find(u => u.owner === 'player' && u.isHero);
  const startPos = { x: 3, y: 6 };
  let archPos = null;
  for (let x = 0; x < BOARD_W; x++) for (let y = 0; y < BOARD_H; y++) {
    if (distance(startPos, { x, y }) === 3 && y === 6 && x > startPos.x) archPos = { x, y };
  }
  const MOVER = mk({ id: 'F_MOVER', owner: 'ai', name: 'Mover', pos: startPos,
                     currentHp: 30, maxHp: 30,
                     stats: { hp: 30, atk: 70, def: 20, mag: 1, res: 20, spd: 2 },
                     moves: [JAB], aiActed: false, hasMoved: false, hasAttacked: false,
                     _skillDodge: (opts.dodge === undefined ? 40 : opts.dodge) });
  const ARCHER = mk({ id: 'F_ARCHER', owner: 'player', name: 'Archer', pos: archPos,
                      stats: { hp: 3000, atk: 70, def: 10, mag: 10, res: 10, spd: 1 },
                      moves: [SHOT] });
  s.units = [
    Object.assign({}, aiHero, { pos: { x: 0, y: 0 }, aiActed: true, hasMoved: true, hasAttacked: true }),
    // The player hero is parked far away on the ARCHER'S side, so the AI's
    // "advance on the hero" term PULLS TOWARD the danger. A hero parked behind
    // the mover would have made the safe tile win on its own and the arm would
    // have proved nothing.
    Object.assign({}, pHero, { pos: { x: BOARD_W - 1, y: 6 }, moves: [] }),
    MOVER, ARCHER,
    mk({ id: 'F_DECOY', owner: 'player', name: 'Decoy', pos: { x: BOARD_W - 1, y: 0 }, currentHp: 5, maxHp: 5 }),
  ];
  s.ai = s.ai || {}; s.ai.energy = 10;
  s.comboHits = {}; s.log = []; s.weather = null;
  return { start: startPos, arch: archPos, dStartArch: distance(startPos, archPos) };
};

/* What the board actually is, re-measured every run rather than asserted from
   memory: for every tile the mover can reach, the EXPECTED and the LANDED
   incoming damage, plus the attack score the tile is worth. */
window.__probeF = function () {
  const s = App.state;
  const mover = s.units.find(u => u.id === 'F_MOVER');
  const arch  = s.units.find(u => u.id === 'F_ARCHER');
  const shot  = arch.moves[0];
  const tiles = getValidMoves(mover, s.units, s.weather).map(t => {
    const ghost = { ...mover, pos: t };
    const inReach = distance(t, arch.pos) <= (shot.range + 1);
    const evP = calculateDamage({ ...shot, accuracy: 100, crit: 0 }, arch, ghost, s.weather, { aiExpectedValue: true });
    const laP = calculateDamage({ ...shot, accuracy: 100, crit: 0 }, arch, { ...ghost, _skillDodge: 0 }, s.weather, { aiExpectedValue: true });
    return { x: t.x, y: t.y, dArch: distance(t, arch.pos),
             ev: aiIncomingThreatAt(ghost, t, s),
             landed: inReach ? laP.damage : 0,
             pHit: evP.hitChance };
  });
  const lethal = tiles.filter(t => t.landed >= mover.currentHp);
  return { hp: mover.currentHp, tiles,
           lethalTiles: lethal.length,
           safeTiles: tiles.length - lethal.length,
           worstEv: Math.max(0, ...tiles.map(t => t.ev)),
           worstLanded: Math.max(0, ...tiles.map(t => t.landed)),
           attackScore: aiScoreAttack(mover, arch, mover.moves[0], s, null) };
};

window.__runF = function (opts) {
  window.__setupF(opts);
  App.state.turn = 'ai';
  App.ui = App.ui || {}; App.ui.aiBusy = true;
  try { scheduleAIStep(1); } catch (e) { App.ui.aiBusy = false; }
};
/* The EFFECT, not a scoring number: WHERE the unit actually ended up. A tile
   within the archer's reach is a tile where the landed shot kills it. */
window.__readF = function () {
  const s = App.state;
  const m = s.units.find(u => u.id === 'F_MOVER') || {};
  const a = s.units.find(u => u.id === 'F_ARCHER') || {};
  const d = (m.pos && a.pos) ? distance(m.pos, a.pos) : -1;
  return { pos: m.pos, dArch: d, moved: !!m.hasMoved, lethalTile: d >= 0 && d <= 2 };
};
`;

/* One AI turn on a freshly rebuilt board. Rebuilt every turn so every sample
   sees identical conditions (HP, comboHits, log, energy). */
async function aiTurn(pg) {
  await pg.evaluate(() => { window.__setupBoard(); });
  await pg.evaluate(() => {
    const s = App.state;
    s.turn = 'ai';
    App.ui = App.ui || {};
    App.ui.aiBusy = true;
    try { scheduleAIStep(1); } catch (e) { App.ui.aiBusy = false; }
  });
  await pg.waitForFunction('!(App.ui && App.ui.aiBusy) || !App.state || App.state.gameOver',
    null, { timeout: 45000 }).catch(() => {});
  return await pg.evaluate(() => window.__readChoice());
}

async function armC(pg, turns) {
  const r = { solid: 0, slip: 0, missed: 0, none: 0, turns: 0, acted: 0 };
  for (let i = 0; i < turns; i++) {
    const c = await aiTurn(pg);
    r.turns++;
    if (c.acted) r.acted++;
    if (c.solid) r.solid++;
    else if (c.slip) r.slip++;
    else if (c.missed) r.missed++;
    else r.none++;
  }
  return r;
}

/* One AI turn on the ARM E board. Same rebuild-every-turn discipline as
   aiTurn, so every sample sees identical HP / log / energy. */
async function aiTurnKO(pg) {
  await pg.evaluate(() => { window.__setupKO(); });
  await pg.evaluate(() => {
    const s = App.state; s.turn = 'ai';
    App.ui = App.ui || {}; App.ui.aiBusy = true;
    try { scheduleAIStep(1); } catch (e) { App.ui.aiBusy = false; }
  });
  await pg.waitForFunction('!(App.ui && App.ui.aiBusy) || !App.state || App.state.gameOver',
    null, { timeout: 45000 }).catch(() => {});
  return await pg.evaluate(() => window.__readKO());
}

async function armE(pg, turns) {
  const r = { frail: 0, frailDead: 0, wall: 0, dodged: 0, none: 0, turns: 0, acted: 0 };
  for (let i = 0; i < turns; i++) {
    const c = await aiTurnKO(pg);
    r.turns++; if (c.acted) r.acted++;
    if (c.frailHit) { r.frail++; if (c.frailDead) r.frailDead++; }
    else if (c.wallHit) r.wall++;
    else if (c.missed) { r.frail++; r.dodged++; }   // only FRAIL can dodge
    else r.none++;
  }
  return r;
}

console.log('\n\u{1F3B2} AI DAMAGE ESTIMATE — dice roll or expectation?\n');

const pgEV = await open('index.html');
await pgEV.evaluate(BOARD);
const pgCTL = await open('__control__.html');
await pgCTL.evaluate(BOARD);

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '\n           ' + d)); };

/* ── ARM 0 · the control document is what it claims to be ────────────────── */
console.log('  ── ARM 0 · the control document');
ok('the flag is set at EXACTLY two call sites (aiEstimateThreat + aiScoreAttack)',
  stripCount === 2, 'found ' + stripCount + ' occurrences of "' + FLAG_ARG + '" in public/index.html');
const sites = shipped.split('\r\n').map((l, i) => ({ l, i: i + 1 }))
  .filter(x => x.l.indexOf('aiExpectedValue: true') >= 0).map(x => x.i);
console.log('           set at lines ' + sites.join(', '));
ok('the control document really lost them', controlDoc.indexOf(FLAG_ARG) < 0 && controlDoc.length === shipped.length - stripCount * FLAG_ARG.length,
  'control is ' + (shipped.length - controlDoc.length) + ' bytes shorter');

/* ── ARM A · the mechanism, same units, same run ─────────────────────────── */
console.log('\n  ── ARM A · rolled vs expected on the SAME attacker/defender/move');
const A = await pgEV.evaluate(() => {
  const mk = (o) => Object.assign({
    id: o.id, name: o.id, owner: o.owner, alive: true, isHero: false,
    pos: o.pos, currentHp: 500, maxHp: 500,
    stats: { hp: 500, atk: 30, def: 10, mag: 20, res: 10, spd: 2 },
    elements: ['neutral'], passives: [], statusEffects: [], stages: {},
  }, o);
  const MOVE = { id: 'probe', name: 'probe', kind: 'attack', type: 'physical',
                 element: 'neutral', power: 30, accuracy: 100, crit: 0, range: 1 };
  const att = mk({ id: 'att', owner: 'ai', pos: { x: 1, y: 1 } });
  const run = (def, opts, n) => {
    const h = {};
    for (let i = 0; i < n; i++) {
      const p = calculateDamage({ ...MOVE, accuracy: 100, crit: 0 }, att, def, null, opts);
      h[p.damage] = (h[p.damage] || 0) + 1;
    }
    const keys = Object.keys(h).map(Number).sort((a, b) => a - b);
    return { hist: h, distinct: keys.length, lo: keys[0], hi: keys[keys.length - 1] };
  };
  const dodgy = mk({ id: 'dodgy', owner: 'player', pos: { x: 2, y: 1 }, _skillDodge: 40 });
  const critty = mk({ id: 'critty', owner: 'player', pos: { x: 2, y: 1 } });
  const crAtt = mk({ id: 'crAtt', owner: 'ai', pos: { x: 1, y: 1 }, _loadoutCritBonus: 60 });
  const runA = (a, d, opts, n) => {
    const h = {};
    for (let i = 0; i < n; i++) {
      const p = calculateDamage({ ...MOVE, accuracy: 100, crit: 0 }, a, d, null, opts);
      h[p.damage] = (h[p.damage] || 0) + 1;
    }
    const keys = Object.keys(h).map(Number).sort((x, y) => x - y);
    return { hist: h, distinct: keys.length, lo: keys[0], hi: keys[keys.length - 1] };
  };
  return {
    dodgeRolled: run(dodgy, undefined, 300),
    dodgeExpect: run(dodgy, { aiExpectedValue: true }, 300),
    critRolled: runA(crAtt, critty, undefined, 300),
    critExpect: runA(crAtt, critty, { aiExpectedValue: true }, 300),
  };
});
const dR = A.dodgeRolled, dE = A.dodgeExpect, cR = A.critRolled, cE = A.critExpect;
ok('rolled + _skillDodge:40 → the oracle is NOISY (the bug)',
  dR.distinct >= 2, JSON.stringify(dR.hist));
ok('expected + _skillDodge:40 → exactly ONE value',
  dE.distinct === 1, JSON.stringify(dE.hist));
ok('…and it sits STRICTLY BETWEEN the rolled extremes (an expectation, not a floor or ceiling)',
  dE.lo > dR.lo && dE.hi < dR.hi, dR.lo + ' < ' + dE.lo + ' < ' + dR.hi);
ok('rolled + _loadoutCritBonus:60 → the oracle is NOISY (the bug)',
  cR.distinct >= 2, JSON.stringify(cR.hist));
ok('expected + _loadoutCritBonus:60 → exactly ONE value',
  cE.distinct === 1, JSON.stringify(cE.hist));
ok('…and it sits STRICTLY BETWEEN the rolled extremes',
  cE.lo > cR.lo && cE.hi < cR.hi, cR.lo + ' < ' + cE.lo + ' < ' + cR.hi);

/* ── ARM B · the AI's own threat map, on a real board ────────────────────── */
console.log('\n  ── ARM B · aiIncomingThreatAt on a real initGame board (the map the movement loop reads)');
const B = await pgEV.evaluate(() => {
  window.__setupBoard();
  const s = App.state;
  const att = s.units.find(u => u.id === 'DRV_ATT');
  // aiIncomingThreatAt sums PLAYER attackers onto an AI unit, so the dodge has
  // to sit on the AI unit being threatened. Give the crafted attacker to the
  // player side for this measurement only.
  s.units = s.units.map(u => u.id === 'DRV_ATT' ? { ...u, owner: 'player' } : u);
  const victim = { ...att, owner: 'ai', _skillDodge: 50,
                   pos: s.units.find(u => u.id === 'DRV_SOLID').pos };
  const roll = (n) => { const h = {}; for (let i = 0; i < n; i++) { const t = aiIncomingThreatAt(victim, victim.pos, s); h[t] = (h[t] || 0) + 1; } const k = Object.keys(h).map(Number).sort((a, b) => a - b); return { hist: h, distinct: k.length, lo: k[0], hi: k[k.length - 1] }; };
  return { threat: roll(200) };
});
ok('the threat map returns ONE value across 200 reads (it returned three)',
  B.threat.distinct === 1, JSON.stringify(B.threat.hist));

/* ── ARM C · the real AI, a board with one right answer ──────────────────── */
console.log('\n  ── ARM C · the REAL doAIStep picks a target');
const geo = await pgEV.evaluate(() => window.__setupBoard());
console.log('           reach — solid ' + geo.d_solid + ' · slippery ' + geo.d_slip + ' · decoy ' + geo.d_decoy + ' (jab range 1)');
const setup = await pgEV.evaluate(() => {
  window.__setupBoard();
  const s = App.state;
  const att = s.units.find(u => u.id === 'DRV_ATT');
  const solid = s.units.find(u => u.id === 'DRV_SOLID');
  const slip = s.units.find(u => u.id === 'DRV_SLIP');
  const mv = att.moves[0];
  const evd = (t) => calculateDamage({ ...mv, accuracy: 100, crit: 0 }, att, t, null, { aiExpectedValue: true }).damage;
  const raw = (t) => calculateDamage({ ...mv, accuracy: 100, crit: 0 }, att, { ...t, _skillDodge: 0 }, null, { aiExpectedValue: true }).damage;
  return { solidLanded: raw(solid), slipLanded: raw(slip), solidExpect: evd(solid), slipExpect: evd(slip) };
});
console.log('           a LANDED jab: solid ' + setup.solidLanded + ' · slippery ' + setup.slipLanded +
            '   |   EXPECTED: solid ' + setup.solidExpect + ' · slippery ' + setup.slipExpect);
ok('the board really has one right answer: slippery is the juicier HIT but the worse BET',
  setup.slipLanded > setup.solidLanded && setup.slipExpect < setup.solidExpect,
  'needs landed(slip) > landed(solid) AND expected(slip) < expected(solid)');

const TURNS = 25;
const C_ev = await armC(pgEV, TURNS);
const C_ctl = await armC(pgCTL, TURNS);
console.log('           expected-value build : ' + JSON.stringify(C_ev));
console.log('           CONTROL rolled build : ' + JSON.stringify(C_ctl));
ok('every turn produced an attack (the scenario is live, not inert)',
  C_ev.none === 0 && C_ctl.none === 0, 'turns with no attack at all — ev ' + C_ev.none + ' · control ' + C_ctl.none);
ok('\u{1F3AF} with expectations, the AI picks the RIGHT target on all ' + TURNS + ' turns',
  C_ev.solid === TURNS && C_ev.slip === 0 && C_ev.missed === 0,
  'solid ' + C_ev.solid + ' · slippery ' + C_ev.slip + ' · chosen-then-dodged ' + C_ev.missed);
ok('\u{1F3AF} CONTROL — the rolled build takes the bad bet repeatedly',
  C_ctl.solid <= TURNS - 3 && (C_ctl.slip + C_ctl.missed) >= 3,
  'solid ' + C_ctl.solid + ' · slippery ' + C_ctl.slip + ' · chosen-then-dodged ' + C_ctl.missed +
  ' (needs ≥ 3 wrong picks out of ' + TURNS + '; the dodge is 60% so ~10 are expected)');

/* ── ARM E · the AI must STILL take a probable kill ──────────────────────── */
/* Taking the variance out of probe.damage took it out of the KO test too, and
   an unbiased term became a bias to ZERO: a 60%-lethal blow read as "not a
   kill", so the +800 stopped firing on every evasive target. Arm C proves the
   AI now takes the better BET; this arm proves it did not lose the ability to
   EXECUTE. Both must hold at once — either alone can be satisfied by a build
   that is worse overall, which is why both run. */
console.log('\n  ── ARM E · the REAL doAIStep takes a 60%-likely KILL over safe chip damage');
const geoKO = await pgEV.evaluate(() => window.__setupKO());
console.log('           reach — frail ' + geoKO.d_frail + ' · wall ' + geoKO.d_wall + ' · decoy ' + geoKO.d_decoy + ' (jab range 1)');
const koSetup = await pgEV.evaluate(() => {
  window.__setupKO();
  const s = App.state;
  const att = s.units.find(u => u.id === 'KO_ATT');
  const frail = s.units.find(u => u.id === 'KO_FRAIL');
  const wall = s.units.find(u => u.id === 'KO_WALL');
  const mv = att.moves[0];
  const evd = (t) => calculateDamage({ ...mv, accuracy: 100, crit: 0 }, att, t, null, { aiExpectedValue: true });
  return {
    frailHp: frail.currentHp,
    frailLanded: evd({ ...frail, _skillDodge: 0 }).damage,
    frailExpect: evd(frail).damage,
    frailHitChance: evd(frail).hitChance,
    wallLanded: evd(wall).damage,
    scoreFrail: aiScoreAttack(att, frail, mv, s, null),
    scoreWall: aiScoreAttack(att, wall, mv, s, null),
  };
});
console.log('           FRAIL ' + koSetup.frailHp + ' HP: landed ' + koSetup.frailLanded + ' (LETHAL) · expected ' +
            koSetup.frailExpect + ' · hitChance ' + koSetup.frailHitChance +
            '   |   WALL: ' + koSetup.wallLanded + ' chip');
console.log('           aiScoreAttack — frail ' + koSetup.scoreFrail + ' · wall ' + koSetup.scoreWall);
ok('the position is what it claims: a LANDED jab kills FRAIL but the EXPECTED number does not',
  koSetup.frailLanded >= koSetup.frailHp && koSetup.frailExpect < koSetup.frailHp && koSetup.wallLanded < 3000,
  'landed ' + koSetup.frailLanded + ' >= ' + koSetup.frailHp + ' > expected ' + koSetup.frailExpect);
ok('the KO bonus survives the expectation — scoring the kill beats scoring the chip',
  koSetup.scoreFrail > koSetup.scoreWall + 300,
  'frail ' + koSetup.scoreFrail + ' vs wall ' + koSetup.scoreWall +
  ' (on expected damage alone it would be ' + koSetup.frailExpect + ' vs ' + koSetup.wallLanded + ' — the WRONG way round)');

const KTURNS = 20;
const E_ev = await armE(pgEV, KTURNS);
const E_ctl = await armE(pgCTL, KTURNS);
console.log('           expected-value build : ' + JSON.stringify(E_ev));
console.log('           CONTROL rolled build : ' + JSON.stringify(E_ctl));
ok('every turn produced an attack (the scenario is live, not inert)',
  E_ev.none === 0 && E_ctl.none === 0, 'turns with no attack — ev ' + E_ev.none + ' · control ' + E_ctl.none);
ok('\u{1F480} the expected-value build GOES FOR THE KILL (the regression this arm was added for)',
  E_ev.frail >= KTURNS * 0.8 && E_ev.frailDead >= 1,
  'ev chose frail ' + E_ev.frail + '/' + KTURNS + ' (landed the kill ' + E_ev.frailDead + '×, dodged ' + E_ev.dodged +
  '×) — the broken cut scored 0/' + KTURNS + ' and hit the wall every turn');
ok('\u{1F480} CONTROL — the rolled build went for the kill too, so this is not a NEW behaviour',
  E_ctl.frail >= 3 && E_ctl.frailDead >= 1,
  'control chose frail ' + E_ctl.frail + '/' + KTURNS + ' (killed ' + E_ctl.frailDead + ')');
ok('the fix did not make the AI WORSE at executing than the rolled build it replaced',
  E_ev.frail >= E_ctl.frail,
  'ev ' + E_ev.frail + ' vs control ' + E_ctl.frail + ' turns spent on the killable target');

/* ── ARM F · the DEFENDER side: does the SUICIDE GUARD still fire? ───────── */
/* aiScoreAttack was the attacker half of the expectation-vs-lethality bug and
   ARM E covers it. aiEstimateThreat is the defender half and is the higher
   traffic one: the movement loop reads it for EVERY candidate tile of EVERY
   unit, and the suicide guard at the bottom of that loop asks a LETHALITY
   question — "would the incoming threat here KILL me?" — of a number that had
   become an average. This arm runs the real doAIStep on a board where the
   right answer is unambiguous and reads back WHERE THE UNIT STOOD. */
console.log('\n  ── ARM F · the REAL doAIStep refuses a tile that kills it whenever the shot lands');

/* ♻ RELOAD BEFORE EACH SUB-ARM. A page that has already rebuilt the board and
   run ~65 AI turns gets slow enough that scheduleAIStep's 8-SECOND WATCHDOG
   starts ending turns before the unit has moved. That is not a property of any
   build — measured, the two pages that had done 65 turns lost EVERY turn of the
   mechanism sub-arm while the freshly-opened third page lost none — but it
   silently empties the sample, so each sub-arm gets a clean document. */
async function refresh(pg, doc) {
  await pg.goto('http://127.0.0.1:' + P + '/' + doc, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForFunction('typeof calculateDamage === "function" && typeof initGame === "function" && typeof aiIncomingThreatAt === "function"', null, { timeout: 200000 });
  await pg.waitForTimeout(4000);
  await pg.evaluate(BOARD);
}

const pgPRE = await open('__prefix__.html');
await pgPRE.evaluate(BOARD);
await refresh(pgEV, 'index.html');
await refresh(pgCTL, '__control__.html');

ok('the pre-fix document reverted the guard at EXACTLY one site',
  guardHits === 1, 'found ' + guardHits + ' occurrences of the fixed suicide guard in public/index.html');
ok('the pre-fix document really is the OLD guard',
  prefixDoc.indexOf(GUARD_OLD) >= 0 && prefixDoc.indexOf(GUARD_NEW) < 0,
  'reverted body present: ' + (prefixDoc.indexOf(GUARD_OLD) >= 0));

const geoF = await pgEV.evaluate(() => window.__setupF({}));
const probeF = await pgEV.evaluate(() => { window.__setupF({}); return window.__probeF(); });
console.log('           mover ' + probeF.hp + ' HP at (' + geoF.start.x + ',' + geoF.start.y +
            ') · archer at (' + geoF.arch.x + ',' + geoF.arch.y + ') · ' + geoF.dStartArch + ' steps away');
console.log('           reachable tiles: ' + probeF.tiles.length + ' — ' + probeF.lethalTiles +
            ' inside the archer\'s reach, ' + probeF.safeTiles + ' outside');
console.log('           worst tile: EXPECTED ' + probeF.worstEv + ' · LANDED ' + probeF.worstLanded +
            ' · attackScore for standing there ' + probeF.attackScore);
ok('the position is what it claims: the shot KILLS as it lands but not as an average',
  probeF.worstLanded >= probeF.hp && probeF.worstEv < probeF.hp,
  'landed ' + probeF.worstLanded + ' >= ' + probeF.hp + ' HP > expected ' + probeF.worstEv);
ok('the guard is ALLOWED to veto this tile (attackScore is under its 700 bypass)',
  probeF.attackScore < 700, 'attackScore ' + probeF.attackScore);
ok('there is somewhere safe to stand, so refusing is a real option',
  probeF.safeTiles > 0 && probeF.lethalTiles > 0,
  probeF.lethalTiles + ' lethal / ' + probeF.safeTiles + ' safe');

async function turnF(pg, opts) {
  await pg.evaluate((o) => { window.__runF(o); }, opts);
  await pg.waitForFunction('!(App.ui && App.ui.aiBusy) || !App.state || App.state.gameOver',
    null, { timeout: 45000 }).catch(() => {});
  return await pg.evaluate(() => window.__readF());
}
/* ⚠ `nomove` is a HARNESS artifact, not an AI decision, and everything below is
   normalised over MOVED turns because of it. scheduleAIStep has an 8-second
   watchdog that ends the AI turn wherever it got to; this arm drives three
   browser contexts in one process and a turn that normally takes ~3s can blow
   past 8s under that load, leaving the unit standing on its start tile with
   hasMoved false. Measured with a SINGLE context and nothing else running, the
   fixed build moved on 20 turns out of 20 and landed on (3,5) every time — so a
   nomove turn is the harness losing the turn, not the AI declining to act.
   It cannot manufacture a pass either way: the start tile is one of the SAFE
   ones, so counting it would flatter the fixed build and flatter the pre-fix
   build's failures too. Only turns where the unit actually moved are scored. */
async function armF(pg, opts, turns) {
  const r = { lethal: 0, safe: 0, nomove: 0, turns: 0, moved: 0, tiles: {} };
  for (let i = 0; i < turns; i++) {
    const c = await turnF(pg, opts);
    r.turns++;
    if (!c.moved) { r.nomove++; continue; }
    r.moved++;
    const k = c.pos ? (c.pos.x + ',' + c.pos.y) : 'none';
    r.tiles[k] = (r.tiles[k] || 0) + 1;
    if (c.lethalTile) r.lethal++; else r.safe++;
  }
  return r;
}

const FTURNS = 20;
const F_fix = await armF(pgEV,  { dodge: 40 }, FTURNS);
const F_pre = await armF(pgPRE, { dodge: 40 }, FTURNS);
const F_ctl = await armF(pgCTL, { dodge: 40 }, FTURNS);
console.log('           FIXED build            : ' + JSON.stringify(F_fix));
console.log('           PRE-FIX (ev, old guard): ' + JSON.stringify(F_pre));
console.log('           CONTROL (rolled)       : ' + JSON.stringify(F_ctl));
ok('enough turns survived the watchdog in all three builds to mean anything',
  F_fix.moved >= FTURNS / 2 && F_pre.moved >= FTURNS / 2 && F_ctl.moved >= FTURNS / 2,
  'turns the unit actually moved — fixed ' + F_fix.moved + ' · pre-fix ' + F_pre.moved +
  ' · control ' + F_ctl.moved + ' of ' + FTURNS + ' (the rest are watchdog losses, see armF)');
ok('\u{1F6D1} the FIXED build never walks onto the lethal tile',
  F_fix.lethal === 0 && F_fix.moved > 0,
  'stood somewhere lethal ' + F_fix.lethal + '/' + F_fix.moved + ' moved turns');
ok('\u{1F6D1} CONTROL · PRE-FIX build walks onto it EVERY time — the regression this arm exists for',
  F_pre.moved > 0 && F_pre.lethal === F_pre.moved,
  'pre-fix stood somewhere lethal ' + F_pre.lethal + '/' + F_pre.moved +
  ' moved turns (expectation 25 < 30 HP, so the guard never fired at all)');
/* The rolled build's discriminator is NOT "how often it refused" — that is a
   binomial and at 20 turns it can come back 0 by luck, which would be a test
   that fails one run in sixteen for no reason. Its real signature is that it
   cannot make the same decision twice: it re-rolls the threat map for EVERY
   candidate tile, so the winner wanders. The fixed build lands on ONE tile. */
const distinct = (r) => Object.keys(r.tiles).length;
ok('\u{1F6D1} CONTROL · the ROLLED build cannot decide — its choice wanders across tiles',
  distinct(F_ctl) >= 2,
  'rolled build ended on ' + distinct(F_ctl) + ' different tiles ' + JSON.stringify(F_ctl.tiles) +
  ' across ' + F_ctl.moved + ' moved turns (refusing on ' + F_ctl.safe + ' of them); the fixed build ' +
  'ended on ' + distinct(F_fix));
/* 📐 REPORTED, NOT ASSERTED — and the distinction is the honest part. The first
   draft of this line asserted the fixed build lands on ONE tile every turn and
   it FAILED 19/20: the odd turn picked (3,7), the mirror image of (3,5) about
   the archer's row — same distance, same threat, same score, a genuine tie. So
   the claim "the AI is now deterministic" is TOO STRONG and is not made here.
   What this piece removed is the DICE ROLL IN THE DAMAGE ORACLE; tie-breaks
   elsewhere in doAIStep are untouched and were never in scope. The assertion
   that matters is the one above it — every one of those tiles is safe. */
const modal = (r) => Math.max(0, ...Object.values(r.tiles));
console.log('           (choice concentration, reported not asserted — fixed ' + modal(F_fix) + '/' +
  F_fix.moved + ' on one tile across ' + distinct(F_fix) + ' tiles, rolled ' + modal(F_ctl) + '/' +
  F_ctl.moved + ' across ' + distinct(F_ctl) + '. The fixed build is steadier but not single-valued: ' +
  'ties between mirror-image tiles are broken elsewhere in the AI, not in the damage oracle.)');

/* The mechanism check. Take the dodge away and the archer's shot is certain,
   so EXPECTED and LANDED are the same number and all three builds must agree.
   If a build still walks onto the tile here, the guard itself is broken and
   nothing above is about the probability discount. */
const FT2 = 12;
await refresh(pgEV, 'index.html');
await refresh(pgPRE, '__prefix__.html');
await refresh(pgCTL, '__control__.html');
const G_fix = await armF(pgEV,  { dodge: 0 }, FT2);
const G_pre = await armF(pgPRE, { dodge: 0 }, FT2);
const G_ctl = await armF(pgCTL, { dodge: 0 }, FT2);
console.log('           dodge removed — fixed ' + G_fix.lethal + '/' + G_fix.moved +
            ' · pre-fix ' + G_pre.lethal + '/' + G_pre.moved + ' · control ' + G_ctl.lethal + '/' + G_ctl.moved +
            ' lethal tiles (of moved turns)');
ok('\u{1F50E} MECHANISM — with the dodge removed ALL THREE builds refuse the tile',
  G_fix.lethal === 0 && G_pre.lethal === 0 && G_ctl.lethal === 0
  && G_fix.moved > 0 && G_pre.moved > 0 && G_ctl.moved > 0,
  'the guard is intact in every build; it was defeated ONLY by the probability discount. ' +
  'This is the arm that rules out "the fix just made the AI timid": remove the uncertainty ' +
  'and the PRE-FIX build refuses the very tile it took 100% of the time with the dodge on.');

/* ── ARM D · TRIPWIRE · live combat still rolls ──────────────────────────── */
console.log('\n  ── ARM D · TRIPWIRE — the unflagged path must still be a dice roll');
const D = await pgEV.evaluate(() => {
  const mk = (o) => Object.assign({
    id: o.id, name: o.id, owner: o.owner, alive: true, isHero: false,
    pos: o.pos, currentHp: 100, maxHp: 100,
    stats: { hp: 100, atk: 20, def: 10, mag: 20, res: 10, spd: 2 },
    elements: ['neutral'], passives: [], statusEffects: [], stages: {},
  }, o);
  const MOVE = { id: 'probe', name: 'probe', kind: 'attack', type: 'physical',
                 element: 'neutral', power: 20, accuracy: 100, crit: 0, range: 1 };
  const att = mk({ id: 'a', owner: 'ai', pos: { x: 1, y: 1 } });
  const sample = (def, n) => {
    const h = {}; let miss = 0;
    for (let i = 0; i < n; i++) {
      const p = calculateDamage({ ...MOVE, accuracy: 100, crit: 0 }, att, def, null);
      h[p.damage] = (h[p.damage] || 0) + 1; if (p.missed) miss++;
    }
    return { hist: h, distinct: Object.keys(h).length, missPct: Math.round(100 * miss / n) };
  };
  return {
    sterile: sample(mk({ id: 'd1', owner: 'player', pos: { x: 2, y: 1 } }), 300),
    dodge40: sample(mk({ id: 'd2', owner: 'player', pos: { x: 2, y: 1 }, _skillDodge: 40 }), 300),
    mirror: sample(mk({ id: 'd3', owner: 'player', pos: { x: 2, y: 1 }, statusEffects: [{ type: 'mirror', turnsLeft: 3 }] }), 300),
  };
});
ok('sterile pair still lands one damage number 300/300 (unchanged live path)',
  D.sterile.distinct === 1 && D.sterile.missPct === 0, JSON.stringify(D.sterile));
ok('_skillDodge:40 STILL MISSES ~40% live — if this goes quiet the bypass leaked',
  D.dodge40.missPct >= 30 && D.dodge40.missPct <= 52, JSON.stringify(D.dodge40));
ok('the mirror status STILL dodges ~50% live',
  D.mirror.missPct >= 38 && D.mirror.missPct <= 62, JSON.stringify(D.mirror));

console.log('\npage errors: ' + errs.length); errs.slice(0, 6).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
