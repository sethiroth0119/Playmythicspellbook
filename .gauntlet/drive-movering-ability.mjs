/* ══════════════════════════════════════════════════════════════════════════
   🎯 DRIVE-MOVERING-ABILITY — does a no-target ability FIRE from the move ring?

   THE ASK: "when the ability move buttons are clicked activate the ability, it
   does not trigger when clicked."

   THE BUG: every chip in the ring took one path — set selectedMoveId, set
   actionMode 'attack', close, wait for a board click. That is right for an
   attack and wrong for an ability with no board target (self / allAllies /
   allEnemies / summon): there is nothing legal to click, so the move never
   resolved. The two older menus (.modal-move in the unit modal, .move-btn in
   the rail) both branch on _moveIsNoTarget already; the ring never learned it.

   THE TEST, and why it is a driver and not a grep: the claim is "clicking the
   chip resolves the move", so this really clicks the chip — b.click() on the
   element the ring built — and then reads the STATE, not the DOM:

     · the caster spent its action     (hasAttacked / usedPriority flips)
     · energy fell by the move's cost
     · the battle log grew

   Any one of those alone can lie (a log line is written by the arming path too
   on some moves), so a pass needs the action flag AND one of the other two.

   ⚠ A CONTROL RUNS FIRST. An attack chip is clicked in the same session and
     must NOT resolve — it must arm targeting instead. Without that half, a
     handler that fired EVERYTHING on click would pass this file while breaking
     every attack in the game.

   Run: node .gauntlet/drive-movering-ability.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const P = 7500 + (process.pid % 90);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.route('**/*', (r) => { const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof initGame==="function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(5000);

const out = await pg.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rep = { steps: [] };
  try {
    localStorage.setItem('mg_onboarded', '1');
    document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.auth-gate,#auth-overlay,.modal-overlay').forEach(e => e.remove());
  } catch (e) {}

  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null); App.screen = 'battle';
  try { if (typeof _uiAutoScale === 'function') _uiAutoScale(); } catch (e) {}
  renderBattleNow();
  await sleep(1200);
  try { document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.modal-overlay').forEach(e => e.remove()); } catch (e) {}

  /* Give the player room: plenty of energy, and it is their turn. */
  App.state.turn = 'player';
  App.state.player.energy = 9;

  const mine = () => (App.state.units || []).filter(u => u && u.alive && u.owner === 'player');
  const movesOf = (u) => (Array.isArray(u.knownMoves) ? u.knownMoves : []).map(id => lookupMove(id)).filter(Boolean);

  /* Find a caster that knows a no-target ability. If the starter roster has
     none, TEACH one — the claim under test is about the ring's dispatch, not
     about which heroes happen to ship with a self-buff. The move is picked
     from the game's own catalogue so it resolves through the real executeMove. */
  let caster = null, ability = null;
  for (const u of mine()) {
    const a = movesOf(u).find(m => _moveIsNoTarget(m));
    if (a) { caster = u; ability = a; break; }
  }
  if (!caster) {
    const all = (typeof MOVES === 'object' && MOVES) ? Object.values(MOVES) : [];
    const pick = all.find(m => m && _moveIsNoTarget(m) && (m.cost | 0) <= 3 && m.kind !== 'summon');
    if (pick && mine().length) {
      caster = mine()[0];
      caster.knownMoves = [pick.id].concat(caster.knownMoves || []);
      ability = pick;
      rep.taught = pick.id;
    }
  }
  if (!caster || !ability) { rep.fatal = 'no no-target ability available to test'; return rep; }
  rep.caster = caster.name || caster.id;
  rep.ability = { id: ability.id, name: ability.name, kind: ability.kind, target: ability.target || null, cost: ability.cost | 0 };

  /* The ring needs an anchor rect; the real caller sets it from the hovered
     unit's action menu. Anchor on the caster's own tile the same way. */
  const anchorFor = (u) => {
    const el = document.querySelector('[data-unit-id="' + u.id + '"]')
            || document.querySelector('#unit-' + u.id)
            || document.querySelector('.battle-screen');
    return el ? el.getBoundingClientRect() : null;
  };

  const openRing = (u) => {
    try { window._uhmRect = anchorFor(u); } catch (e) {}
    if (typeof _uhmRect !== 'undefined') { try { eval('_uhmRect = anchorFor(u)'); } catch (e) {} }
    App.ui.selectedUnitId = u.id;
    return _openMoveRing(u.id);
  };

  const chipFor = (moveId) => document.querySelector('#move-ring [data-mvr-move="' + moveId + '"]');

  /* ── CONTROL · an ATTACK chip must ARM, not resolve ───────────────────── */
  const atk = movesOf(caster).find(m => m.kind === 'attack' && (m.cost | 0) <= (App.state.player.energy | 0));
  if (atk) {
    App.ui.selectedMoveId = null; App.ui.actionMode = null;
    const opened = openRing(caster);
    const chip = chipFor(atk.id);
    const before = { e: App.state.player.energy | 0, acted: !!caster.hasAttacked, log: (App.state.log || []).length };
    if (opened && chip) {
      chip.click();
      await sleep(350);
      const now = (App.state.units || []).find(x => x.id === caster.id) || caster;
      rep.steps.push({
        step: 'control · attack chip', move: atk.id,
        armed: App.ui.selectedMoveId === atk.id,
        resolved: (!!now.hasAttacked && !before.acted) || (App.state.player.energy | 0) < before.e,
        ringClosed: !document.getElementById('move-ring'),
      });
    } else rep.steps.push({ step: 'control · attack chip', skipped: true, opened, chip: !!chip });
    /* leave targeting mode before the real test */
    App.ui.selectedMoveId = null; App.ui.actionMode = null;
    try { _hideTargetCancel(); } catch (e) {}
    try { _closeMoveRing(); } catch (e) {}
  }

  /* ── THE TEST · an ABILITY chip must RESOLVE on click ─────────────────── */
  const c0 = (App.state.units || []).find(x => x.id === caster.id) || caster;
  c0.hasAttacked = false; c0.usedPriority = false;
  App.state.player.energy = 9;
  const before = {
    energy: App.state.player.energy | 0,
    acted: !!(c0.hasAttacked || c0.usedPriority),
    log: (App.state.log || []).length,
  };
  const opened = openRing(c0);
  const chip = chipFor(ability.id);
  rep.ringOpened = !!opened;
  rep.chipFound = !!chip;
  if (!chip) { rep.fatal = 'ability chip not drawn in the ring'; return rep; }

  chip.click();
  await sleep(500);

  const c1 = (App.state.units || []).find(x => x.id === caster.id) || c0;
  const after = {
    energy: App.state.player.energy | 0,
    acted: !!(c1.hasAttacked || c1.usedPriority),
    log: (App.state.log || []).length,
  };
  rep.before = before; rep.after = after;
  rep.ringClosed = !document.getElementById('move-ring');
  rep.leftArmed = !!App.ui.selectedMoveId;         // must be false — nothing to target
  rep.spentAction = after.acted && !before.acted;
  rep.spentEnergy = after.energy < before.energy;
  rep.logGrew = after.log > before.log;
  rep.tail = (App.state.log || []).slice(-3).map(x => String((x && x.text) || x).slice(0, 90));
  return rep;
});
await b.close(); srv.close();

const ok = (v) => v ? '[32mPASS[0m' : '[31mFAIL[0m';
console.log('\n🎯 MOVE RING · does an ability fire when its chip is clicked?\n');
if (out.fatal) { console.log('  FATAL: ' + out.fatal); process.exit(1); }
console.log('  caster   : ' + out.caster);
console.log('  ability  : ' + out.ability.name + '  (' + out.ability.kind + ' · target ' + out.ability.target + ' · cost ' + out.ability.cost + ')'
  + (out.taught ? '   [taught for the test]' : ''));
for (const s of out.steps) {
  if (s.skipped) { console.log('\n  control · attack chip: SKIPPED (opened=' + s.opened + ' chip=' + s.chip + ')'); continue; }
  console.log('\n  CONTROL — an attack must ARM and must NOT resolve');
  console.log('    armed for targeting  ' + ok(s.armed));
  console.log('    did not resolve      ' + ok(!s.resolved));
  console.log('    ring closed          ' + ok(s.ringClosed));
}
console.log('\n  TEST — the ability must RESOLVE');
console.log('    ring drew the chip   ' + ok(out.chipFound));
console.log('    action spent         ' + ok(out.spentAction) + '   (' + out.before.acted + ' → ' + out.after.acted + ')');
console.log('    energy spent         ' + ok(out.spentEnergy) + '   (' + out.before.energy + ' → ' + out.after.energy + ')');
console.log('    log grew             ' + ok(out.logGrew) + '   (' + out.before.log + ' → ' + out.after.log + ')');
console.log('    not left armed       ' + ok(!out.leftArmed));
console.log('    ring closed          ' + ok(out.ringClosed));
console.log('\n  log tail: ' + JSON.stringify(out.tail, null, 0));
const pass = out.chipFound && out.spentAction && (out.spentEnergy || out.logGrew) && !out.leftArmed && out.ringClosed
  && out.steps.every(s => s.skipped || (s.armed && !s.resolved));
console.log('\n  VERDICT: ' + (pass ? '[32mABILITIES FIRE FROM THE RING[0m' : '[31mSTILL BROKEN[0m') + '\n');
process.exit(pass ? 0 : 1);
