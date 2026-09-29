/* ══════════════════════════════════════════════════════════════════════════
   🎯 DRIVE-MULTI-TARGET — a card that hits N things, picked one at a time.

   "_tgtSet is a single-pick set today. Multi-select needs a pick count on the
    effect, an accumulating selection, and a confirm step."

   All three, against the real engine, on a real board:

     1. THE COUNT is read off the effect and clamped. A card without one behaves
        exactly as every card written before this did — that is the whole
        compatibility contract, so it is asserted rather than assumed.
     2. THE SELECTION ACCUMULATES. A legal click on a multi-pick step banks an
        id and does NOT resolve; the picked unit drops out of the lit set so it
        cannot be chosen twice; the effect fires once per target when the count
        is met.
     3. THE CONFIRM fires early with fewer picks than the card asked for, which
        is what makes a 3-target card playable on a board holding two.

   🔴 AND THE CONTROLS, because "damage happened" proves nothing on its own:
        · a single-target card still resolves on the FIRST click (no regression)
        · a second click on an already-picked unit is refused (it is not lit)
        · an illegal click with picks banked does NOT throw the selection away
        · the AI fans out to N distinct units too — a multi-target card in an AI
          deck used to hit once, which is the asymmetry that reads as broken

   Run:  node .gauntlet/drive-multi-target.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8640 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof initGame === "function" && typeof _resolveTargetClick === "function" && typeof _targetCountOf === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(() => {
  const o = { steps: [] };
  o.reachable = typeof _targetCountOf === 'function' && typeof _applyEffectToTargets === 'function'
             && typeof _resolveTargetClick === 'function' && typeof _confirmTargeting === 'function';
  if (!o.reachable) return o;

  // ── 1 · the count, and its compatibility contract ───────────────────────
  o.countAbsent = _targetCountOf({ type: 'targetStrike' });          // must be 1
  o.countThree  = _targetCountOf({ targetCount: 3 });
  o.countClamp  = _targetCountOf({ targetCount: 99 });               // clamped to 6
  o.countJunk   = _targetCountOf({ targetCount: 'lots' });           // must be 1

  /* ── a board: three enemies in a row beside one player unit ─────────── */
  const mkBoard = () => {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null);
    App.screen = 'battle';
    const s = App.state;
    s.controlPoints = []; s.weather = null; s.surfaces = {}; s.activeLocation = null;
    s.log = []; s.gameOver = null; s.turnNumber = 1; s.turn = 'player';
    /* 🔴 EVERY BLOCK BELOW STARTS FROM A CLEAN PICKER AND AN EMPTY QUEUE.
       Without these two lines the AI block's leftovers reached the player
       block: a stale _pendingTargets is re-armed by renderBattle the moment
       the picker repaints, which silently replaced the queue under the test
       and read as 'the first click resolved everything'. Measured — the
       failure looked exactly like a broken accumulate. */
    s._pendingTargets = [];
    App.ui = App.ui || {}; App.ui.targeting = null;
    const mk = (id, owner, x, y) => ({
      id, owner, name: id, isHero: false, alive: true, level: 5,
      currentHp: 900, maxHp: 900,
      stats: { hp: 900, atk: 10, def: 10, mag: 10, res: 10, spd: 1 },
      elements: ['neutral'], passives: [], statusEffects: [], stages: {},
      pos: { x, y }, moves: [], hasAttacked: false, hasMoved: false,
    });
    // The caster sits centre; the three enemies are all within radius.
    s.units = [ mk('CASTER', 'player', 4, 4),
                mk('E1', 'ai', 5, 4), mk('E2', 'ai', 3, 4), mk('E3', 'ai', 4, 3) ];
    return s;
  };
  const hpOf = (id) => { const u = (App.state.units || []).find(x => x.id === id); return u ? (u.currentHp | 0) : -1; };

  /* A targeted, multi-target damage effect. `targetStrike` is in
     _TARGETABLE_EFFECTS and reads a single _targetId — which is the point: the
     fan-out must work WITHOUT the effect knowing anything about lists. */
  const eff3 = { type: 'targetStrike', targeted: true, amount: 100, tSide: 'enemy', targetCount: 3 };

  /* ── 2 · the AI fans out ─────────────────────────────────────────────────
     ⚠ THE BOARD IS MIRRORED FOR THIS ONE, and the first cut of it was wrong in
       a way worth recording: an AI caster's ENEMIES are the PLAYER's units, so
       running the AI test on the player board handed _targetCandidates a list
       containing only the caster's own side. It picked one target, hit nobody
       the test was watching, and read as 'the AI fan-out is broken' when the
       fan-out was fine and the board was upside down. */
  {
    const s = mkBoard();
    s.units = s.units.map(u => u.id === 'CASTER' ? { ...u, owner: 'ai' } : { ...u, owner: 'player' });
    s.turn = 'ai';
    const caster = s.units.find(u => u.id === 'CASTER');
    const after = _applyOnPlayOne(s, caster, { id: 'tst', name: 'Volley', onPlay: eff3 });
    o.aiHit = ['E1', 'E2', 'E3'].map(id => (after.units.find(u => u.id === id) || {}).currentHp);
    o.aiHitCount = o.aiHit.filter(hp => hp < 900).length;
  }

  // ── 3 · the player picker accumulates ───────────────────────────────────
  {
    const s = mkBoard();
    const caster = s.units.find(u => u.id === 'CASTER');
    App.ui = App.ui || {};
    App.ui.targeting = { queue: [{ effect: eff3, casterId: 'CASTER', casterOwner: 'player',
                                   card: { id: 'tst', name: 'Volley' } }], idx: 0 };
    o.litBefore = _currentTargetIds().size;                       // 3 enemies lit
    // first pick — must NOT resolve
    _resolveTargetClick(5, 4);                                    // E1
    const _tg = App.ui.targeting;
    o.afterPick1 = { picked: _tg ? ((_tg.queue[0]._picked||[]).length) : -1,
                     stillTargeting: !!_tg,
                     e1hp: hpOf('E1'),
                     lit: _tg ? (_currentTargetIds()||{size:-1}).size : -1,
                     idx: _tg ? _tg.idx : -1 };
    if (!_tg) return o;
    // the picked unit is no longer lit — a second click on it is not legal
    _resolveTargetClick(5, 4);
    o.doublePickIgnored = App.ui.targeting.queue[0]._picked.length === 1;
    // an ILLEGAL click (empty ground) with a pick banked must not discard it
    _resolveTargetClick(0, 0);
    o.misclickKeptPicks = !!App.ui.targeting && App.ui.targeting.queue[0]._picked.length === 1;
    // second and third picks — the third meets the count and fires
    _resolveTargetClick(3, 4);                                    // E2
    o.afterPick2 = { picked: App.ui.targeting.queue[0]._picked.length, e2hp: hpOf('E2') };
    _resolveTargetClick(4, 3);                                    // E3
    o.afterPick3 = { targeting: !!App.ui.targeting,
                     hp: ['E1', 'E2', 'E3'].map(hpOf) };
  }

  // ── 4 · the confirm fires early ─────────────────────────────────────────
  {
    const s = mkBoard();
    App.ui.targeting = { queue: [{ effect: eff3, casterId: 'CASTER', casterOwner: 'player',
                                   card: { id: 'tst', name: 'Volley' } }], idx: 0 };
    _resolveTargetClick(5, 4);                                    // one pick only
    o.confirmReturn = _confirmTargeting();
    o.afterConfirm = { targeting: !!App.ui.targeting, hp: ['E1', 'E2', 'E3'].map(hpOf) };
  }

  // ── 5 · CONTROL: a single-target card still resolves on the first click ──
  {
    const s = mkBoard();
    const eff1 = { type: 'targetStrike', targeted: true, amount: 100, tSide: 'enemy' };
    App.ui.targeting = { queue: [{ effect: eff1, casterId: 'CASTER', casterOwner: 'player',
                                   card: { id: 'tst', name: 'Single' } }], idx: 0 };
    _resolveTargetClick(5, 4);
    o.single = { targeting: !!App.ui.targeting, e1hp: hpOf('E1'), e2hp: hpOf('E2') };
  }
  /* ── 6 · ⛓ THE CHAIN MODE — 'all at once' vs 'one after another' ─────────
     The + chain item asked for simultaneous as a CHOICE. What 'together' means
     here is that every effect in the chain picks its target from the board as
     it stood BEFORE the chain — so two effects that both want 'the strongest
     enemy' hit the SAME one, instead of the second re-scanning after the first
     has killed it.
     Both effects are single-target strikes, and the board has three enemies at
     different HP so 'strongest' is unambiguous. */
  {
    const s = mkBoard();
    /* ⚠ MIRRORED, for the same reason the AI block above is: the caster is the
       AI (a player caster would QUEUE the picker instead of resolving, and a
       queued step is not a chain), so its ENEMIES have to be the player's
       units. Getting this backwards is why the first draft measured zero
       damage in both modes and read as 'the chain does nothing'. */
    s.units = s.units.map(u => u.id === 'CASTER' ? { ...u, owner: 'ai' }
                            /* HP chosen so the two modes MUST diverge and
                               neither answer depends on death or cleanup: one
                               500 strike leaves E1 at 400, which is BELOW E2's
                               500 — so a re-scan picks E2 and a pinned chain
                               does not. */
                            : u.id === 'E1' ? { ...u, owner: 'player', currentHp: 900 }
                            : u.id === 'E2' ? { ...u, owner: 'player', currentHp: 500 }
                            : u.id === 'E3' ? { ...u, owner: 'player', currentHp: 300 } : u);
    s.turn = 'ai';
    const caster = s.units.find(u => u.id === 'CASTER');
    const one = { type: 'targetStrike', targeted: true, amount: 500, tSide: 'enemy' };
    // SEQUENTIAL: the first strike drops E1 to 400, so the second re-scans and
    // may pick a different unit — the classic behaviour, unchanged.
    /* 🔴 A FRESH BOARD PER MODE. The reducer returns new state objects but the
       UNIT objects inside them are shared and mutated, so running 'sequence'
       and then 'together' over the same state starts the second run on a board
       the first already damaged — E2 was at 0 before 'together' ever fired, and
       the mode got the blame. Same class of bug as the engine one this case
       exists to cover, one level up, in the test. */
    const mirror = (st) => { st.units = st.units.map(u => u.id === 'CASTER' ? { ...u, owner: 'ai' }
                              : u.id === 'E1' ? { ...u, owner: 'player', currentHp: 900 }
                              : u.id === 'E2' ? { ...u, owner: 'player', currentHp: 500 }
                              : u.id === 'E3' ? { ...u, owner: 'player', currentHp: 300 } : u);
                             st.turn = 'ai'; return st; };
    const sA = mirror(mkBoard());
    const seq = applyOnPlayEffect(sA, sA.units.find(u => u.id === 'CASTER'),
                                  { id: 't', name: 'Twin', onPlay: one, onPlayExtra: [one] });
    o.seqHp = ['E1','E2','E3'].map(id => (seq.units.find(u => u.id === id) || {}).currentHp);
    const sB = mirror(mkBoard());
    const tog = applyOnPlayEffect(sB, sB.units.find(u => u.id === 'CASTER'),
                                  { id: 't', name: 'Twin', onPlay: one, onPlayExtra: [one], onPlayChain: 'together' });
    o.togHp = ['E1','E2','E3'].map(id => (tog.units.find(u => u.id === id) || {}).currentHp);
  }
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('the multi-target engine is not in this build');
else {
  need('absent count = 1', out.countAbsent === 1, out.countAbsent);
  need('a count of 3 reads as 3', out.countThree === 3);
  need('99 clamps to 6', out.countClamp === 6, out.countClamp);
  need('junk falls back to 1', out.countJunk === 1, out.countJunk);

  need('AI hit three distinct units', out.aiHitCount === 3, out.aiHit);

  need('all three enemies start lit', out.litBefore === 3, out.litBefore);
  need('first click banks a pick', out.afterPick1.picked === 1, out.afterPick1);
  need('…and does NOT resolve yet', out.afterPick1.e1hp === 900, out.afterPick1);
  need('…and keeps the picker open', out.afterPick1.stillTargeting === true);
  need('a picked unit drops out of the lit set', out.afterPick1.lit === 2, out.afterPick1);
  need('CONTROL: it cannot be picked twice', out.doublePickIgnored === true);
  need('CONTROL: a misclick keeps the banked picks', out.misclickKeptPicks === true);
  need('second click banks, still no damage', out.afterPick2.picked === 2 && out.afterPick2.e2hp === 900, out.afterPick2);
  need('the third pick fires and closes the picker', out.afterPick3.targeting === false, out.afterPick3);
  need('all three took damage, once each', out.afterPick3.hp.every(hp => hp === 800), out.afterPick3.hp);

  need('confirm fired early', out.confirmReturn === true && out.afterConfirm.targeting === false, out.afterConfirm);
  need('…hitting only the one picked', out.afterConfirm.hp[0] === 800 && out.afterConfirm.hp[1] === 900, out.afterConfirm.hp);

  /* ⛓ E1 starts at 900 and each strike is 500. Under 'together' both land on
     E1 (900 → 0 or clamped), and E2/E3 are untouched. Under 'sequence' the
     second strike re-scans a changed board, so SOMETHING else is hit — the two
     modes must produce different boards, which is the whole claim. */
  // together: both 500s land on E1 (900 → 0 or below-clamped); E2 untouched.
  need('⛓ together: both hits land on the same unit',
       out.togHp[0] <= 0 && out.togHp[1] === 500 && out.togHp[2] === 300, out.togHp);
  // sequence: the first drops E1 to 400, the re-scan then picks E2 (500).
  need('⛓ sequence: the second effect re-scans and picks another',
       out.seqHp[0] === 400 && out.seqHp[1] <= 0, out.seqHp);
  need('⛓ CONTROL: sequence produces a DIFFERENT board', JSON.stringify(out.seqHp) !== JSON.stringify(out.togHp),
       { seq: out.seqHp, together: out.togHp });
  need('CONTROL: single-target still resolves on click 1', out.single.targeting === false && out.single.e1hp === 800, out.single);
  need('CONTROL: …and hits only that one', out.single.e2hp === 900, out.single);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 4) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the count is read, the selection accumulates, the confirm fires early, and single-target is untouched.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
