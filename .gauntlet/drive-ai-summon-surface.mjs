/* ══════════════════════════════════════════════════════════════════════════
   🔥 DRIVE-AI-SUMMON-SURFACE — does the AI still throw a fresh unit into a fire?

   aiPickBestPlacement scored a candidate tile with exactly three terms:

       sc  = -distToFoe * 6                       // closer to the player hero
       sc -= incoming * (isTank ? 0.4 : 1.2)      // aiIncomingThreatAt
       sc += 20  when isTank && distToFoe <= 2    // tanks like the front

   and read NO SURFACE AT ALL. The movement scorer has read one since v119
   (fire -45, oil -12, water-in-a-lightning-storm -22), so the AI would walk
   AROUND a blaze all day and then deploy the next card straight into it. And
   a deploy is the worse of the two: fire's standDamage burns whatever ENDS
   its turn on the tile, and buildUnit hands back a summoning-sick unit, so the
   summon eats the burn tick the instant it lands with no chance to step off.

   This file drives the REAL summon — scheduleAIStep → doAIStep phase 1 →
   aiPickBestPlacement → buildUnit → the unit on the board — and asserts the
   POSITION OF THE UNIT THAT APPEARED. Not the return value of a helper, not a
   score: where the body ended up.

   ── THE THREE ARMS ────────────────────────────────────────────────────────
   One board, built identically every time: a flat 6-neighbour ring around the
   AI hero, one harmless player hero far enough away that aiIncomingThreatAt is
   ASSERTED to be 0 on every candidate (so the ranking is pure distance and the
   experiment cannot be confounded by the stochastic threat map), and a single
   20-HP unit card in the AI's hand (under the isTank cutoff of 24, so the tank
   bonus never fires either).

     T0 is DISCOVERED, not predicted: it is the tile the PRE-FIX build picks on
     that board with no fire anywhere. Then fire is painted on T0 itself.

     ARM 1  pre-fix build, fire on T0   → summons ONTO T0.        the bug
     ARM 2  fixed build,   fire on T0   → summons somewhere ELSE. the fix
     ARM 3  fixed build,   NO fire      → summons back onto T0.   ← the judge

   🔴 ARM 3 IS THE DISCRIMINATOR. Any perturbation of the placement score —
     a changed constant, a reordered loop, an extra term — passes arms 1 and 2.
     Only a change that is genuinely SURFACE-CONDITIONED leaves the fire-free
     board's answer untouched. Arm 1 and arm 3 must name the SAME TILE. If the
     fixed build picks a different tile in arm 3, the scoring moved and this
     file FAILS, whatever arms 1 and 2 said.

   ARM 4 (the same idea from the other side): fire on a tile that was NOT going
   to win anyway must not move the pick either. A global penalty would.

   ARM 5 (additive): the surface read is wrapped in try/catch. A third build is
   served with the _surfaceAt call replaced by a throw — the count of replaced
   lines is ASSERTED to be exactly 1 — and its answer must be arm 1's tile
   exactly. That is what "purely additive; losing it degrades to the old
   scoring" means, exercised rather than asserted in a comment.

   ⚠ THE CONTROL IS A SECOND BUILD SERVED IN THE SAME RUN, not a number in a
     comment — the same pattern drive-ai-threat-reach uses, for the same reason.
     /__control__.html is public/index.html with the ONE surface-read line
     replaced by `null`, which is textually the pre-fix function.

   ⚠ EVERY ARM RUNS N TIMES with the board rebuilt from scratch each time and
     requires all N answers to be the same tile. buildUnit rolls nature/trait,
     so "the AI picked X once" is not a claim about the AI.

   Run:  node .gauntlet/drive-ai-summon-surface.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const N = 5;                                   // runs per arm; all must agree
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

/* ── THREE builds off one file, differing in ONE line ──────────────────────── */
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const FIXED_LINE = "      const _ps = (typeof _surfaceAt === 'function') ? _surfaceAt(state, t.x, t.y) : null;";
const OLD_LINE   = "      const _ps = null;";
const THROW_LINE = "      const _ps = (function () { throw new Error('drive-ai-summon-surface: forced'); })();";
let stripCount = 0;
{ let i = 0; while ((i = SRC.indexOf(FIXED_LINE, i)) !== -1) { stripCount++; i++; } }
const CONTROL = SRC.split(FIXED_LINE).join(OLD_LINE);
const THROWS  = SRC.split(FIXED_LINE).join(THROW_LINE);

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  if (p === '/__control__.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(CONTROL); }
  if (p === '/__throws__.html')  { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(THROWS); }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
const P = 8840 + (process.pid % 40);
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
  await pg.waitForFunction('typeof initGame === "function" && typeof aiPickBestPlacement === "function" && typeof scheduleAIStep === "function" && typeof _setSurface === "function" && typeof getValidPlacementTiles === "function"',
    null, { timeout: 200000 });
  await pg.waitForTimeout(5000);
  await installProbes(pg);
  return { pg, errs, file };
}

/* ─────────────────────────────────────────────────────────────────────────
   THE BOARD. Deliberately sterile so the placement ranking is a single
   repeatable ordering:
     • every wall / trap / pre-seeded environmental surface wiped, so all six
       neighbours of the AI hero are legal and IDENTICAL across builds (initGame
       seeds a random environment — leaving it in would make the three builds
       three different boards);
     • the player hero parked ~6 tiles away with weaponRange 1, SPD 1 and no
       moves of its own, so aiIncomingThreatAt is 0 on every candidate. That is
       ASSERTED by __probeTiles below, not assumed;
     • one 20-HP unit card in hand — under the isTank cutoff (>= 24), so the
       +20 front-line term never fires either.
   What is left of the pre-fix score is therefore exactly `-distToFoe * 6`.
   ───────────────────────────────────────────────────────────────────────── */
async function installProbes(pg) {
  await pg.evaluate(() => {
    window.__CARD = {
      id: 'drvEmber', instanceId: 'drvEmber#1', name: 'Drv Ember', type: 'unit',
      cost: 1, element: 'neutral', rarity: 'common', desc: 'harness body',
      stats: { hp: 20, atk: 10, def: 5, mag: 5, res: 5, spd: 1 }, moves: [],
    };

    window.__mkBoard = function (fireAt) {
      App.battlePrep = App.battlePrep || {};
      const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
      App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
      App.state = initGame(me, foe, [], true, null);
      App.screen = 'battle';
      const s = App.state;
      s.controlPoints = []; s.cpStreak = { ai: 0, player: 0 };
      s.weather = null; s.activeLocation = null; s.log = []; s.comboHits = {};
      s.sealedTiles = []; s.gameOver = false;
      // Flatten the board: no walls, no traps, no environmental surface.
      for (let y = 0; y < s.board.length; y++) {
        for (let x = 0; x < s.board[y].length; x++) {
          const c = s.board[y][x]; if (!c) continue;
          delete c.surface; delete c.trap; c.wall = false;
        }
      }
      // Nobody's ultimate may fire first and rearrange the board.
      try { for (const k in (s.heroUltimates || {})) s.heroUltimates[k].charge = 0; } catch (e) {}

      const AI_POS = { x: 3, y: 3 };
      let PL_POS = null;
      for (let x = 0; x < s.board[0].length && !PL_POS; x++) {
        for (let y = 0; y < s.board.length && !PL_POS; y++) {
          if (distance(AI_POS, { x, y }) === 6) PL_POS = { x, y };
        }
      }
      const aiH = s.units.find(u => u.owner === 'ai' && u.isHero);
      const plH = s.units.find(u => u.owner === 'player' && u.isHero);
      aiH.pos = AI_POS; aiH.alive = true; aiH.hasMoved = false; aiH.hasAttacked = false; aiH.aiActed = false;
      plH.pos = PL_POS; plH.alive = true;
      // A harmless foe: shortest possible reach, so the threat map reads 0
      // everywhere and the distance term is the only live one pre-fix.
      plH.weaponRange = 1; plH.moves = [];
      plH.stats = Object.assign({}, plH.stats, { spd: 1, atk: 1, mag: 1 });
      s.units = [aiH, plH];

      s.ai.hand = [Object.assign({}, window.__CARD)];
      s.ai.energy = 5;

      if (fireAt) _setSurface(s, fireAt.x, fireAt.y, 'fire', 6);
      return { aiPos: AI_POS, plPos: PL_POS, dist: distance(AI_POS, PL_POS) };
    };

    /* What the board ACTUALLY is: the legal tiles, their distance to the foe,
       and the threat map's reading at each. Read through the same helpers the
       function under test calls. */
    window.__probeTiles = function () {
      const s = App.state;
      const aiH = s.units.find(u => u.owner === 'ai' && u.isHero);
      const plH = s.units.find(u => u.owner === 'player' && u.isHero);
      const tiles = getValidPlacementTiles(window.__CARD, aiH, s);
      return tiles.map(t => ({
        x: t.x, y: t.y,
        dist: distance(t, plH.pos),
        threat: aiIncomingThreatAt({ ...window.__CARD, owner: 'ai', alive: true, currentHp: 20, maxHp: 20, pos: t }, t, s),
        surface: (_surfaceAt(s, t.x, t.y) || {}).type || null,
      }));
    };

    /* Drive one REAL AI turn and record where the summoned body first appears.
       The poller is deliberately fast (5ms) and the pos is captured the moment
       the unit exists, so nothing that happens later in the turn can be
       mistaken for the placement. The end-of-turn pos is captured too and the
       two are compared by the harness — a summoning-sick unit must not move. */
    window.__runTurn = function () {
      const s = App.state;
      window.__firstPos = null; window.__seen = false;
      s.turn = 'ai';
      for (const u of (s.units || [])) {
        if (u && u.owner === 'ai') { u.aiActed = false; u.hasMoved = false; u.hasAttacked = false; }
      }
      const iv = setInterval(() => {
        try {
          const u = (App.state && App.state.units || []).find(z => z && z.name === 'Drv Ember');
          if (u && u.pos && !window.__firstPos) {
            window.__firstPos = { x: u.pos.x, y: u.pos.y }; window.__seen = true;
            clearInterval(iv);
          }
        } catch (e) {}
      }, 5);
      setTimeout(() => clearInterval(iv), 40000);
      App.ui = App.ui || {};
      App.ui.aiBusy = true;
      try { scheduleAIStep(1); } catch (e) { App.ui.aiBusy = false; }
    };

    window.__readSummon = function () {
      const u = (App.state && App.state.units || []).find(z => z && z.name === 'Drv Ember');
      return {
        seen: !!window.__firstPos,
        first: window.__firstPos,
        final: u && u.pos ? { x: u.pos.x, y: u.pos.y } : null,
      };
    };
  });
}

/* One arm = build the board (optionally with fire), drive a real AI turn,
   read where the body landed. Repeated N times; the arm's answer is the set of
   distinct tiles seen, so a flaky AI cannot look decisive. */
async function arm(h, fireAt, n) {
  const seen = [], firsts = [];
  let moved = 0, missing = 0;
  for (let i = 0; i < n; i++) {
    await h.pg.evaluate((f) => window.__mkBoard(f), fireAt);
    await h.pg.evaluate(() => window.__runTurn());
    await h.pg.waitForFunction('!(App.ui && App.ui.aiBusy) || !App.state || App.state.gameOver',
      null, { timeout: 45000 }).catch(() => {});
    const r = await h.pg.evaluate(() => window.__readSummon());
    if (!r.seen || !r.first) { missing++; continue; }
    if (!r.final || r.final.x !== r.first.x || r.final.y !== r.first.y) moved++;
    firsts.push(r.first);
    seen.push(r.first.x + ',' + r.first.y);
  }
  const distinct = [...new Set(seen)];
  return { n, missing, moved, distinct, tile: distinct.length === 1 ? firsts[0] : null, runs: seen };
}
const key = (t) => t ? (t.x + ',' + t.y) : 'none';

let fails = 0;
const ok = (nm, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + nm + (d == null ? '' : '   ' + d)); };

console.log('\n\u{1F525} AI SUMMON — SURFACE AWARENESS AT PLACEMENT\n');
ok('the control build is the shipped file with EXACTLY ONE line replaced',
  stripCount === 1, 'replaced ' + stripCount + ' occurrence(s) of the surface-read line');
if (stripCount !== 1) {
  console.log('\n❌ the control build could not be constructed — nothing below would mean anything.');
  await b.close(); srv.close(); process.exit(1);
}

const FIX = await openBuild('index.html');
const CTL = await openBuild('__control__.html');
const THR = await openBuild('__throws__.html');

/* ── The board, measured before anything is claimed about it ─────────────── */
const geo = await CTL.pg.evaluate(() => window.__mkBoard(null));
const tiles = await CTL.pg.evaluate(() => window.__probeTiles());
console.log('  board: AI hero ' + JSON.stringify(geo.aiPos) + ' · player hero ' +
  JSON.stringify(geo.plPos) + ' · hex distance ' + geo.dist);
console.log('  candidates: ' + tiles.map(t => '(' + t.x + ',' + t.y + ' d' + t.dist + ' thr' + t.threat + ')').join(' '));
ok('the AI hero has its full six-neighbour placement ring (no walls, no seals)',
  tiles.length === 6, tiles.length + ' legal tiles');
ok('\u{1F9EA} the threat map reads ZERO on every candidate — so the pre-fix ranking is PURE DISTANCE ' +
   'and this experiment cannot be confounded by the stochastic threat term',
  tiles.every(t => t.threat === 0), JSON.stringify(tiles.map(t => t.threat)));
ok('no surface anywhere on the fire-free board',
  tiles.every(t => t.surface === null), JSON.stringify(tiles.map(t => t.surface)));

/* ── T0 · DISCOVERED from the pre-fix build, not predicted ───────────────── */
const base = await arm(CTL, null, N);
ok('\u{1F4CD} T0 — the PRE-FIX build picks one and only one tile on the fire-free board, ' + N + '/' + N + ' runs',
  base.distinct.length === 1 && base.missing === 0,
  'picks ' + JSON.stringify(base.runs) + (base.missing ? ' · ' + base.missing + ' runs summoned nothing' : ''));
if (!base.tile) {
  console.log('\n❌ no stable T0 — the arms below would be measuring noise.');
  await b.close(); srv.close(); process.exit(1);
}
const T0 = base.tile;
const T0d = tiles.find(t => t.x === T0.x && t.y === T0.y);
console.log('  T0 = ' + key(T0) + '  (distance to foe ' + (T0d ? T0d.dist : '?') + ')');
console.log('');

/* ── ARM 1 · THE BUG · pre-fix build, fire painted on T0 ─────────────────── */
const a1 = await arm(CTL, T0, N);
ok('\u{1F525} ARM 1 (BEFORE) — the PRE-FIX AI summons ONTO the burning tile, ' + N + '/' + N + ' runs. This is the bug.',
  a1.distinct.length === 1 && key(a1.tile) === key(T0) && a1.missing === 0,
  'landed on ' + JSON.stringify(a1.runs) + ' · fire is on ' + key(T0));

/* ── ARM 2 · THE FIX · same board, same fire ─────────────────────────────── */
const a2 = await arm(FIX, T0, N);
ok('\u{1F6E1} ARM 2 (AFTER) — the FIXED AI summons somewhere ELSE, ' + N + '/' + N + ' runs',
  a2.distinct.length === 1 && key(a2.tile) !== key(T0) && a2.missing === 0,
  'landed on ' + JSON.stringify(a2.runs) + ' · fire is on ' + key(T0));
ok('ARM 2 — it still deployed (the fix declines a tile, it does not decline the card)',
  a2.missing === 0 && a2.tile !== null, a2.missing + ' runs summoned nothing');

/* ── ARM 3 · THE DISCRIMINATOR · fixed build, fire removed ───────────────── */
const a3 = await arm(FIX, null, N);
ok('\u{1F3AF} ARM 3 (THE JUDGEMENT) — take the fire away and the FIXED build goes back to T0, ' + N + '/' + N +
   ' runs. A different tile here would mean the placement SCORING moved rather than a surface term being added.',
  a3.distinct.length === 1 && key(a3.tile) === key(T0) && a3.missing === 0,
  'arm 1 tile ' + key(T0) + ' · arm 3 tile ' + key(a3.tile) + ' · runs ' + JSON.stringify(a3.runs));

/* ── ARM 4 · the penalty is TILE-LOCAL ───────────────────────────────────── */
const other = tiles.map(t => ({ x: t.x, y: t.y })).find(t => key(t) !== key(T0) && key(t) !== key(a2.tile))
           || tiles.map(t => ({ x: t.x, y: t.y })).find(t => key(t) !== key(T0));
const a4 = await arm(FIX, other, N);
ok('\u{1F9F1} ARM 4 — fire on ' + key(other) + ' (a tile that was NOT going to win anyway) does not move the pick off T0, ' +
   N + '/' + N + ' runs. A global penalty would have.',
  a4.distinct.length === 1 && key(a4.tile) === key(T0) && a4.missing === 0,
  'landed on ' + JSON.stringify(a4.runs));

/* ── ARM 5 · ADDITIVE · the try/catch degrades to the old behaviour ──────── */
const a5 = await arm(THR, T0, N);
ok('\u{1F9F7} ARM 5 (ADDITIVE) — with the surface read forced to THROW, behaviour degrades EXACTLY to arm 1: ' +
   'back onto T0, ' + N + '/' + N + ' runs, and the page keeps running',
  a5.distinct.length === 1 && key(a5.tile) === key(a1.tile) && a5.missing === 0,
  'arm 1 tile ' + key(a1.tile) + ' · arm 5 tile ' + key(a5.tile) + ' · runs ' + JSON.stringify(a5.runs));

/* ── the summoned body never moved, so "first pos" IS the placement ──────── */
console.log('');
ok('every arm\'s summon stayed where it was placed (summoning-sick), so the recorded tile is the PLACEMENT ' +
   'and not the result of a later move',
  [base, a1, a2, a3, a4, a5].every(a => a.moved === 0),
  JSON.stringify([base, a1, a2, a3, a4, a5].map(a => a.moved)));

/* ── DIAGNOSTIC (not a gate) · the milder surfaces ───────────────────────── */
await FIX.pg.evaluate((t) => { window.__mkBoard(null); _setSurface(App.state, t.x, t.y, 'oil', 6); }, T0);
const oilPick = await FIX.pg.evaluate(() => {
  const s = App.state; const aiH = s.units.find(u => u.owner === 'ai' && u.isHero);
  const p = aiPickBestPlacement(window.__CARD, aiH, s); return p ? { x: p.x, y: p.y } : null;
});
console.log('  diagnostic (NOT a gate) — oil (-12) on T0 ' + key(T0) + ' → aiPickBestPlacement returns ' + key(oilPick) +
  '. Whether -12 is enough to move the pick depends on the distance gap between T0 and the runner-up ' +
  '(6 points per tile), so this is reported, not asserted.');

console.log('');
ok('no page errors on the fixed build', FIX.errs.length === 0, FIX.errs.slice(0, 3).join(' | '));
ok('no page errors on the control build', CTL.errs.length === 0, CTL.errs.slice(0, 3).join(' | '));
ok('no page errors on the forced-throw build (the catch really does swallow it)',
  THR.errs.length === 0, THR.errs.slice(0, 3).join(' | '));

console.log('');
console.log(fails === 0 ? '✅ PASS' : '❌ ' + fails + ' FAILED');
await b.close(); srv.close();
process.exit(fails === 0 ? 0 : 1);
